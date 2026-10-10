import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { Payment, Prisma } from "../../../generated/prisma/client";
import {
  AppointmentStatus,
  PaymentStatus,
} from "../../../generated/prisma/enums";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { toZonedParts } from "../../common/time/time-zone";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import {
  AppointmentService,
  CompletedStandaloneAppointment,
} from "../appointment/appointment.service";
import { CompanyService } from "../company/company.service";
import { PaymentMethodService } from "../payment-method/payment-method.service";
import { ServiceService } from "../service/service.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { FindPaymentsQueryDto } from "./dto/find-payments-query.dto";
import { SettlePaymentsDto } from "./dto/settle-payments.dto";
import { UpdatePaymentDto } from "./dto/update-payment.dto";

/**
 * O pagamento guarda a própria empresa, porque os de contratação de plano não têm
 * agendamento. Pagamentos de outras empresas respondem 404.
 */
const ownedByCompany = (companyId: string) => ({ companyId });

// Atrasado: pendente com vencimento antes de hoje. A mesma regra do isOverdue.
const isOverdueWhere = (today: Date): Prisma.PaymentWhereInput => ({
  status: PaymentStatus.PENDING,
  dueDate: { lt: today },
});

// O contrário, escrito por extenso: com `NOT`, um vencimento vazio faria o SQL
// descartar o pagamento em vez de considerá-lo "não atrasado".
const isNotOverdueWhere = (today: Date): Prisma.PaymentWhereInput => ({
  OR: [
    { status: { not: PaymentStatus.PENDING } },
    { dueDate: null },
    { dueDate: { gte: today } },
  ],
});

// Aceita o PrismaService ou o cliente de uma transação aberta por outro módulo,
// para que os pagamentos sejam gravados junto com os agendamentos (tudo ou nada).
type PrismaClientLike = Pick<PrismaService, "payment">;

// Agendamento recém-criado que precisa de um pagamento.
export interface AppointmentToCharge {
  id: string;
  startAt: Date;
}

// Pagamento como a API devolve: com o atraso calculado no fuso da empresa.
export type PaymentResponse = Payment & { isOverdue: boolean };

// Um pagamento de contratação de plano: valor e vencimento já calculados.
export interface ClientPlanCharge {
  amount: Decimal;
  dueDate: Date | null;
}

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentService: AppointmentService,
    private readonly paymentMethodService: PaymentMethodService,
    private readonly serviceService: ServiceService,
    private readonly companyService: CompanyService,
  ) {}

  async create(
    dto: CreatePaymentDto,
    companyId: string,
  ): Promise<PaymentResponse> {
    // Ambos validam empresa e existência, lançando 404 quando não pertencem a ela.
    const appointment = await this.appointmentService.findOne(
      dto.appointmentId,
      companyId,
    );
    if (dto.paymentMethodId) {
      await this.paymentMethodService.findOne(dto.paymentMethodId, companyId);
    }

    const status = dto.status ?? PaymentStatus.PENDING;
    this.ensurePaidAtMatchesStatus(status, dto.paidAt);
    this.ensurePaymentMethodWhenPaid(status, dto.paymentMethodId);
    const amount = await this.resolveAmount(
      dto.amount,
      appointment.serviceId,
      companyId,
    );

    try {
      const payment = await this.prisma.payment.create({
        data: { ...dto, amount, status, companyId },
      });

      return this.toResponse(payment, await this.todayFor(companyId));
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async findAll(
    {
      page,
      limit,
      status,
      appointmentId,
      clientPlanId,
      paymentMethodId,
      clientId,
      recurringAppointmentId,
      overdue,
      dueFrom,
      dueTo,
    }: FindPaymentsQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<PaymentResponse>> {
    const today = await this.todayFor(companyId);

    // Cada filtro opcional entra no AND só quando informado.
    const filters: Prisma.PaymentWhereInput[] = [];
    if (clientId) {
      // O cliente vem do agendamento (avulso ou recorrência) ou da contratação.
      filters.push({
        OR: [{ appointment: { clientId } }, { clientPlan: { clientId } }],
      });
    }
    if (recurringAppointmentId) {
      filters.push({ appointment: { recurringAppointmentId } });
    }
    if (overdue !== undefined) {
      filters.push(overdue ? isOverdueWhere(today) : isNotOverdueWhere(today));
    }
    if (dueFrom || dueTo) {
      filters.push({ dueDate: { gte: dueFrom, lte: dueTo } });
    }

    const where: Prisma.PaymentWhereInput = {
      ...ownedByCompany(companyId),
      deletedAt: null,
      status,
      appointmentId,
      clientPlanId,
      paymentMethodId,
      AND: filters,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        // Visão financeira: o que vence primeiro aparece primeiro; sem
        // vencimento vai para o fim.
        orderBy: [
          { dueDate: { sort: "asc", nulls: "last" } },
          { createdAt: "desc" },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      items: items.map((payment) => this.toResponse(payment, today)),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string, companyId: string): Promise<PaymentResponse> {
    const payment = await this.findOwned(id, companyId);

    return this.toResponse(payment, await this.todayFor(companyId));
  }

  // Busca sem calcular o atraso: usada internamente por update e remove.
  private async findOwned(id: string, companyId: string): Promise<Payment> {
    const payment = await this.prisma.payment.findFirst({
      where: { id, deletedAt: null, ...ownedByCompany(companyId) },
    });

    if (!payment) {
      throw new NotFoundException("Pagamento não encontrado");
    }

    return payment;
  }

  async update(
    id: string,
    dto: UpdatePaymentDto,
    companyId: string,
  ): Promise<PaymentResponse> {
    const payment = await this.findOwned(id, companyId);

    if (dto.paymentMethodId) {
      await this.paymentMethodService.findOne(dto.paymentMethodId, companyId);
    }

    // Estado final do pagamento, considerando o que veio no PATCH.
    const status = dto.status ?? payment.status;

    // Sair de PAID limpa a data do pagamento, então a data atual não conta na
    // validação: só reclama se o próprio PATCH tentar informar uma data.
    const clearsPaidAt = status !== PaymentStatus.PAID;
    const paidAt = clearsPaidAt
      ? (dto.paidAt ?? null)
      : (dto.paidAt ?? payment.paidAt);
    this.ensurePaidAtMatchesStatus(status, paidAt);
    this.ensurePaymentMethodWhenPaid(
      status,
      dto.paymentMethodId ?? payment.paymentMethodId,
    );

    const updated = await this.prisma.payment.update({
      where: { id },
      data: { ...dto, paidAt, updatedAt: new Date() },
    });

    return this.toResponse(updated, await this.todayFor(companyId));
  }

  async remove(id: string, companyId: string): Promise<void> {
    await this.findOwned(id, companyId);

    const now = new Date();
    await this.prisma.payment.update({
      where: { id },
      data: { deletedAt: now, updatedAt: now },
    });
  }

  /**
   * Gera um pagamento PENDING para cada agendamento de uma recorrência, dentro
   * da transação de quem chama. Sem método: ele é informado na baixa.
   *
   * O vencimento é o dia do agendamento no relógio da empresa: um atendimento
   * às 22h em UTC-3 já é o dia seguinte em UTC, mas vence no dia local.
   */
  async createPendingForAppointments(
    db: PrismaClientLike,
    companyId: string,
    appointments: AppointmentToCharge[],
    amount: number | Decimal,
    timeZone: string,
  ): Promise<number> {
    const { count } = await db.payment.createMany({
      data: appointments.map((appointment) => ({
        companyId,
        appointmentId: appointment.id,
        amount,
        dueDate: this.toLocalDate(appointment.startAt, timeZone),
      })),
    });

    return count;
  }

  /**
   * Job de cobrança: um pagamento PENDING para cada avulso concluído sem pagamento,
   * com o preço do serviço e vencimento no dia local do agendamento
   * Sem método: ele é informado na baixa
   */
  async createForCompletedAppointments(
    appointments: CompletedStandaloneAppointment[],
  ): Promise<number> {
    const data: Prisma.PaymentCreateManyInput[] = [];

    for (const { id, companyId, startAt, service, company } of appointments) {
      // A consulta já descarta serviço sem preço; a checagem garante o tipo.
      if (service.price === null) {
        continue;
      }

      data.push({
        companyId,
        appointmentId: id,
        amount: service.price,
        dueDate: this.toLocalDate(startAt, company.timezone),
      });
    }

    // Duas execuções ao mesmo tempo não duplicam: o banco só aceita um pagamento
    // por agendamento, e o skipDuplicates ignora o repetido.
    const { count } = await this.prisma.payment.createMany({
      data,
      skipDuplicates: true,
    });

    return count;
  }

  /**
   * Gera os pagamentos de uma contratação de plano, dentro da transação da
   * contratação: um no integral, um por mês no mensal. Nascem PENDING, sem
   * método (informado na baixa) e sem agendamento: pertencem à contratação.
   */
  async createForClientPlan(
    db: PrismaClientLike,
    companyId: string,
    clientPlanId: string,
    charges: ClientPlanCharge[],
  ): Promise<number> {
    const { count } = await db.payment.createMany({
      data: charges.map(({ amount, dueDate }) => ({
        companyId,
        clientPlanId,
        amount,
        dueDate,
      })),
    });

    return count;
  }

  /**
   * Cancelamento de uma contratação mensal: as parcelas PENDING que vencem na
   * data informada ou depois viram CANCELLED. As atrasadas continuam PENDING (a
   * dívida permanece) e as pagas não mudam.
   */
  async cancelUpcomingForClientPlan(
    db: PrismaClientLike,
    clientPlanId: string,
    fromDueDate: Date,
  ): Promise<number> {
    const { count } = await db.payment.updateMany({
      where: {
        clientPlanId,
        status: PaymentStatus.PENDING,
        deletedAt: null,
        dueDate: { gte: fromDueDate },
      },
      data: { status: PaymentStatus.CANCELLED, updatedAt: new Date() },
    });

    return count;
  }

  /**
   * Cancela os pagamentos ainda PENDING dos agendamentos futuros cancelados de
   * uma recorrência. Os já pagos não mudam: cancelar não gera reembolso. Deve
   * rodar depois do cancelamento dos agendamentos, na mesma transação.
   */
  async cancelPendingForRecurrence(
    db: PrismaClientLike,
    recurringAppointmentId: string,
    from: Date,
  ): Promise<number> {
    const { count } = await db.payment.updateMany({
      where: {
        status: PaymentStatus.PENDING,
        deletedAt: null,
        appointment: {
          recurringAppointmentId,
          status: AppointmentStatus.CANCELLED,
          startAt: { gte: from },
        },
      },
      data: { status: PaymentStatus.CANCELLED, updatedAt: new Date() },
    });

    return count;
  }

  // Cancelar um agendamento da recorrência cancela o pagamento dele, se ainda pendente.
  async cancelPendingForAppointment(
    db: PrismaClientLike,
    appointmentId: string,
  ): Promise<void> {
    await db.payment.updateMany({
      where: { appointmentId, status: PaymentStatus.PENDING, deletedAt: null },
      data: { status: PaymentStatus.CANCELLED, updatedAt: new Date() },
    });
  }

  /**
   * Remanejamento: o vencimento de um pagamento PENDING acompanha a nova data
   * do agendamento. Pagamento já pago ou cancelado não muda.
   */
  async moveDueDate(
    db: PrismaClientLike,
    appointmentId: string,
    startAt: Date,
    timeZone: string,
  ): Promise<void> {
    await db.payment.updateMany({
      where: { appointmentId, status: PaymentStatus.PENDING, deletedAt: null },
      data: {
        dueDate: this.toLocalDate(startAt, timeZone),
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Baixa em lote: marca como PAID todos os pagamentos PENDING de uma
   * recorrência, com o mesmo método. Atende o cliente que paga tudo de uma vez.
   */
  async settlePendingForRecurrence(
    recurringAppointmentId: string,
    { paymentMethodId, paidAt }: SettlePaymentsDto,
    companyId: string,
  ): Promise<number> {
    await this.paymentMethodService.findOne(paymentMethodId, companyId);

    const now = new Date();
    const { count } = await this.prisma.payment.updateMany({
      where: {
        status: PaymentStatus.PENDING,
        deletedAt: null,
        companyId,
        appointment: { recurringAppointmentId },
      },
      data: {
        status: PaymentStatus.PAID,
        paymentMethodId,
        paidAt: paidAt ?? now,
        updatedAt: now,
      },
    });

    return count;
  }

  // Hoje no calendário da empresa: é a referência do atraso.
  private async todayFor(companyId: string): Promise<Date> {
    const timeZone = await this.companyService.getTimeZone(companyId);

    return this.toLocalDate(new Date(), timeZone);
  }

  /**
   * Atraso é derivado, não gravado: pendente com vencimento antes de hoje. O
   * status continua PENDING até a baixa (ver business-rules.md).
   */
  private toResponse(payment: Payment, today: Date): PaymentResponse {
    const isOverdue =
      payment.status === PaymentStatus.PENDING &&
      payment.dueDate !== null &&
      payment.dueDate < today;

    return { ...payment, isOverdue };
  }

  // Data pura (coluna `date`) do dia em que o instante cai no fuso da empresa.
  private toLocalDate(instant: Date, timeZone: string): Date {
    const { year, month, day } = toZonedParts(instant, timeZone);

    return new Date(Date.UTC(year, month - 1, day));
  }

  /**
   * Valor do pagamento: o informado ou, na ausência, o preço do serviço do
   * agendamento. Serviço sem preço exige o valor no payload.
   */
  private async resolveAmount(
    amount: number | undefined,
    serviceId: string,
    companyId: string,
  ): Promise<number | Decimal> {
    if (amount !== undefined) {
      return amount;
    }

    const service = await this.serviceService.findOne(serviceId, companyId);
    if (service.price === null) {
      throw new BadRequestException(
        "amount é obrigatório porque o serviço não possui preço",
      );
    }

    return service.price;
  }

  // Só um pagamento PAID tem data de pagamento (ver docs/business-rules.md).
  private ensurePaidAtMatchesStatus(
    status: PaymentStatus,
    paidAt?: Date | null,
  ) {
    if (status === PaymentStatus.PAID && !paidAt) {
      throw new BadRequestException(
        "paidAt é obrigatório quando o pagamento está PAID",
      );
    }

    if (status !== PaymentStatus.PAID && paidAt) {
      throw new BadRequestException(
        "paidAt só pode ser informado quando o pagamento está PAID",
      );
    }
  }

  // Um pagamento só é baixado quando se sabe como foi pago.
  private ensurePaymentMethodWhenPaid(
    status: PaymentStatus,
    paymentMethodId?: string | null,
  ) {
    if (status === PaymentStatus.PAID && !paymentMethodId) {
      throw new BadRequestException(
        "paymentMethodId é obrigatório quando o pagamento está PAID",
      );
    }
  }

  private mapUniqueViolation(error: unknown): unknown {
    return isUniqueConstraintViolation(error)
      ? new ConflictException("Este agendamento já possui um pagamento")
      : error;
  }
}
