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
import { AppointmentService } from "../appointment/appointment.service";
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

// Aceita o PrismaService ou o cliente de uma transação aberta por outro módulo,
// para que os pagamentos sejam gravados junto com os agendamentos (tudo ou nada).
type PrismaClientLike = Pick<PrismaService, "payment">;

// Agendamento recém-criado que precisa de um pagamento.
export interface AppointmentToCharge {
  id: string;
  startAt: Date;
}

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
  ) {}

  async create(dto: CreatePaymentDto, companyId: string): Promise<Payment> {
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
      return await this.prisma.payment.create({
        data: { ...dto, amount, status, companyId },
      });
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
    }: FindPaymentsQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<Payment>> {
    const where: Prisma.PaymentWhereInput = {
      ...ownedByCompany(companyId),
      deletedAt: null,
      status,
      appointmentId,
      clientPlanId,
      paymentMethodId,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, companyId: string): Promise<Payment> {
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
  ): Promise<Payment> {
    const payment = await this.findOne(id, companyId);

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

    return this.prisma.payment.update({
      where: { id },
      data: { ...dto, paidAt, updatedAt: new Date() },
    });
  }

  async remove(id: string, companyId: string): Promise<void> {
    await this.findOne(id, companyId);

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
