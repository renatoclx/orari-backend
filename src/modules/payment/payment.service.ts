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
  PlanBillingType,
} from "../../../generated/prisma/enums";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { toZonedParts, zonedToUtc } from "../../common/time/time-zone";
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
import { FindCheckoutsQueryDto } from "./dto/find-checkouts-query.dto";
import { FindPaymentsQueryDto } from "./dto/find-payments-query.dto";
import { SettleCheckoutDto } from "./dto/settle-checkout.dto";
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

/**
 * Na listagem, a origem de cada pagamento, para a tela descrevê-lo: o
 * atendimento (data e serviço) ou o plano da contratação. Lidos pela chave,
 * sem filtrar exclusão: o nome continua mesmo que o serviço ou o plano mudem.
 */
const withOrigin = {
  appointment: {
    select: {
      id: true,
      startAt: true,
      service: { select: { id: true, name: true } },
    },
  },
  clientPlan: {
    select: { id: true, plan: { select: { id: true, name: true } } },
  },
} satisfies Prisma.PaymentInclude;

export type PaymentListItem = PaymentResponse &
  Prisma.PaymentGetPayload<{ include: typeof withOrigin }>;

// Pagamento dentro da comanda: a origem inclui a modalidade do plano.
const checkoutPaymentInclude = {
  paymentMethod: { select: { id: true, name: true } },
  appointment: {
    select: {
      id: true,
      clientId: true,
      startAt: true,
      service: { select: { id: true, name: true } },
    },
  },
  clientPlan: {
    select: {
      id: true,
      clientId: true,
      billingType: true,
      plan: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.PaymentInclude;

export type CheckoutPayment = Prisma.PaymentGetPayload<{
  include: typeof checkoutPaymentInclude;
}>;

// Comanda: tudo o que o cliente movimenta no dia.
export interface Checkout {
  client: { id: string; name: string };
  total: Decimal;
  pendingTotal: Decimal;
  payments: CheckoutPayment[];
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
    // Agendamento cancelado não gera cobrança: o cancelamento já cancela o
    // pagamento pendente dele, e um novo ficaria sem atendimento a cobrar.
    if (appointment.status === AppointmentStatus.CANCELLED) {
      throw new ConflictException(
        "Agendamento cancelado não pode receber pagamento",
      );
    }
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
  ): Promise<PaginatedResult<PaymentListItem>> {
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
        include: withOrigin,
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

    // Cancelado é estado final: o cancelamento do agendamento, da recorrência ou
    // do plano não pode ser desfeito por aqui (reabrir a cobrança de algo que
    // não vai acontecer). Repetir CANCELLED é aceito, sem efeito.
    if (
      payment.status === PaymentStatus.CANCELLED &&
      dto.status !== undefined &&
      dto.status !== PaymentStatus.CANCELLED
    ) {
      throw new ConflictException(
        "Pagamento cancelado não pode mudar de status",
      );
    }

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

  /**
   * Comandas do dia, uma por cliente. "Dia" é hoje no fuso da empresa. Entram os
   * pagamentos PENDING que vencem hoje, os de contratação integral PENDING sem
   * vencimento e os PAID hoje (a comanda paga continua na lista). Atrasados e
   * futuros ficam de fora; excluídos e CANCELLED nunca entram.
   *
   * A paginação é por cliente: primeiro se acham os clientes com movimento
   * (já filtrados e ordenados pelo nome, no banco) e só então se carregam os
   * pagamentos dos clientes da página.
   */
  async findCheckouts(
    { page, limit, search }: FindCheckoutsQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<Checkout>> {
    const dayWhere = await this.checkoutWhere(companyId);

    // Só ids: o cliente vem do agendamento ou da contratação.
    const inDay = await this.prisma.payment.findMany({
      where: dayWhere,
      select: {
        appointment: { select: { clientId: true } },
        clientPlan: { select: { clientId: true } },
      },
    });
    const clientIds = [
      ...new Set(
        inDay.map(
          (payment) =>
            (payment.appointment?.clientId ?? payment.clientPlan?.clientId)!,
        ),
      ),
    ];

    const clientsWhere: Prisma.PeopleWhereInput = {
      companyId,
      id: { in: clientIds },
      normalizedName: search
        ? { contains: normalizeForSearch(search) }
        : undefined,
    };
    // Pessoa excluída continua aparecendo: a comanda ainda tem o que cobrar.
    const [clients, total] = await this.prisma.$transaction([
      this.prisma.people.findMany({
        where: clientsWhere,
        select: { id: true, name: true },
        orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.people.count({ where: clientsWhere }),
    ]);

    const pageIds = clients.map((client) => client.id);
    const payments =
      pageIds.length === 0
        ? []
        : await this.prisma.payment.findMany({
            where: {
              AND: [
                dayWhere,
                {
                  OR: [
                    { appointment: { clientId: { in: pageIds } } },
                    { clientPlan: { clientId: { in: pageIds } } },
                  ],
                },
              ],
            },
            include: checkoutPaymentInclude,
            orderBy: [
              { dueDate: { sort: "asc", nulls: "last" } },
              { createdAt: "asc" },
            ],
          });

    const items = clients.map((client) => {
      const own = payments.filter(
        (payment) =>
          (payment.appointment?.clientId ?? payment.clientPlan?.clientId) ===
          client.id,
      );

      return {
        client,
        total: this.sum(own),
        pendingTotal: this.sum(
          own.filter((payment) => payment.status === PaymentStatus.PENDING),
        ),
        payments: own,
      };
    });

    return { items, total, page, limit };
  }

  /**
   * Baixa dos pagamentos escolhidos, todos do mesmo cliente, com o mesmo método
   * e a mesma data. Tudo ou nada: a conferência e a gravação rodam numa só
   * transação. Erros: 404 (pagamento ou método inexistente na empresa), 409
   * (algum não está PENDING) e 400 (clientes diferentes).
   */
  async settle(
    { paymentIds, paymentMethodId, paidAt }: SettleCheckoutDto,
    companyId: string,
  ): Promise<{ settled: number }> {
    return this.prisma.$transaction(async (tx) => {
      const payments = await tx.payment.findMany({
        where: { id: { in: paymentIds }, deletedAt: null, companyId },
        select: {
          status: true,
          appointment: { select: { clientId: true } },
          clientPlan: { select: { clientId: true } },
        },
      });
      if (payments.length !== paymentIds.length) {
        throw new NotFoundException("Pagamento não encontrado");
      }
      await this.paymentMethodService.findOne(paymentMethodId, companyId);

      if (payments.some((p) => p.status !== PaymentStatus.PENDING)) {
        throw new ConflictException(
          "Só é possível dar baixa em pagamentos pendentes",
        );
      }
      const clients = new Set(
        payments.map((p) => p.appointment?.clientId ?? p.clientPlan?.clientId),
      );
      if (clients.size > 1) {
        throw new BadRequestException(
          "Os pagamentos precisam ser do mesmo cliente",
        );
      }

      const now = new Date();
      // O status no filtro protege de uma baixa concorrente entre a leitura e a gravação.
      const { count } = await tx.payment.updateMany({
        where: {
          id: { in: paymentIds },
          status: PaymentStatus.PENDING,
          deletedAt: null,
          companyId,
        },
        data: {
          status: PaymentStatus.PAID,
          paymentMethodId,
          paidAt: paidAt ?? now,
          updatedAt: now,
        },
      });
      if (count !== paymentIds.length) {
        throw new ConflictException(
          "Só é possível dar baixa em pagamentos pendentes",
        );
      }

      return { settled: count };
    });
  }

  // Filtro da comanda do dia (ver findCheckouts).
  private async checkoutWhere(
    companyId: string,
  ): Promise<Prisma.PaymentWhereInput> {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const now = new Date();
    const today = this.toLocalDate(now, timeZone);
    // Intervalo do dia local em instantes UTC, para comparar com o paidAt.
    const dayStart = (day: number) =>
      zonedToUtc(
        {
          year: today.getUTCFullYear(),
          month: today.getUTCMonth() + 1,
          day,
          hours: 0,
          minutes: 0,
        },
        timeZone,
      );
    const start = dayStart(today.getUTCDate());
    const end = dayStart(today.getUTCDate() + 1);

    return {
      ...ownedByCompany(companyId),
      deletedAt: null,
      OR: [
        { status: PaymentStatus.PENDING, dueDate: today },
        {
          status: PaymentStatus.PENDING,
          dueDate: null,
          clientPlan: { billingType: PlanBillingType.INTEGRAL },
        },
        { status: PaymentStatus.PAID, paidAt: { gte: start, lt: end } },
      ],
    };
  }

  private sum(payments: { amount: Decimal }[]): Decimal {
    return payments.reduce((acc, p) => acc.plus(p.amount), new Decimal(0));
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
  // Genérico: a listagem passa o pagamento com a origem, e ela é mantida.
  private toResponse<T extends Payment>(
    payment: T,
    today: Date,
  ): T & { isOverdue: boolean } {
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
