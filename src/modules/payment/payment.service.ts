import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { Payment, Prisma } from "../../../generated/prisma/client";
import {
  AppointmentStatus,
  AuditAction,
  PaymentStatus,
  UserType,
} from "../../../generated/prisma/enums";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { localDateOf } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import {
  AppointmentService,
  CompletedStandaloneAppointment,
} from "../appointment/appointment.service";
import { AuditService } from "../audit/audit.service";
import { CompanyService } from "../company/company.service";
import { PaymentMethodService } from "../payment-method/payment-method.service";
import { ServiceService } from "../service/service.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { FindPaymentsQueryDto } from "./dto/find-payments-query.dto";
import { SummaryPaymentsQueryDto } from "./dto/summary-payments-query.dto";
import { SettlePaymentsDto } from "./dto/settle-payments.dto";
import { UpdatePaymentDto } from "./dto/update-payment.dto";
import {
  ensurePaidAtIsNotFuture,
  isOverdue,
  mapUniqueViolation,
  saleItemsSelect,
} from "./payment-rules";

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
 * atendimento (data, serviço e se veio de recorrência) ou a contratação
 * (plano e modalidade), além do cliente e do método de pagamento. Lidos pela
 * chave, sem filtrar exclusão: o nome continua mesmo que a pessoa, o serviço ou
 * o plano mudem.
 */
const clientSelect = { select: { id: true, name: true } } as const;

/**
 * O cliente de um pagamento: o do atendimento, o da contratação ou o da venda
 * (todo pagamento tem uma das três origens).
 */
const clientWhere = (clientId: string): Prisma.PaymentWhereInput => ({
  OR: [
    { appointment: { clientId } },
    { clientPlan: { clientId } },
    { productSale: { clientId } },
  ],
});

// Pagamento pago só muda pelo ADMIN (ver business-rules/pagamentos.md).
const PAID_PAYMENT_ADMIN_ONLY =
  "Só o administrador altera ou exclui um pagamento pago";

// Campos do pagamento guardados na auditoria (antes e depois).
const auditSnapshot = (payment: Payment) => ({
  amount: payment.amount.toFixed(2),
  status: payment.status,
  paymentMethodId: payment.paymentMethodId,
  paidAt: payment.paidAt?.toISOString() ?? null,
  dueDate: payment.dueDate?.toISOString().slice(0, 10) ?? null,
});

const SALE_PAYMENT_PROTECTED =
  "O pagamento é de uma venda de produtos: cancele a venda pela comanda";

const withOrigin = {
  paymentMethod: { select: { id: true, name: true } },
  appointment: {
    select: {
      id: true,
      startAt: true,
      recurringAppointmentId: true,
      service: { select: { id: true, name: true } },
      client: clientSelect,
    },
  },
  clientPlan: {
    select: {
      id: true,
      billingType: true,
      plan: { select: { id: true, name: true } },
      client: clientSelect,
    },
  },
  productSale: {
    select: {
      id: true,
      createdAt: true,
      client: clientSelect,
      items: saleItemsSelect,
    },
  },
} satisfies Prisma.PaymentInclude;

type PaymentWithOrigin = Prisma.PaymentGetPayload<{
  include: typeof withOrigin;
}>;

// O cliente sai no nível do pagamento (é o do atendimento, o da contratação ou
// o da venda); a origem não o repete.
export type PaymentListItem = PaymentResponse &
  Omit<PaymentWithOrigin, "appointment" | "clientPlan" | "productSale"> & {
    client: { id: string; name: string };
    appointment: Omit<
      NonNullable<PaymentWithOrigin["appointment"]>,
      "client"
    > | null;
    clientPlan: Omit<
      NonNullable<PaymentWithOrigin["clientPlan"]>,
      "client"
    > | null;
    productSale: Omit<
      NonNullable<PaymentWithOrigin["productSale"]>,
      "client"
    > | null;
  };

// Um cartão do resumo: soma e quantidade, com o total em texto de duas casas.
export interface PaymentSummaryCard {
  total: string;
  count: number;
}

export interface PaymentSummary {
  overdue: PaymentSummaryCard;
  upcoming: PaymentSummaryCard;
  paid: PaymentSummaryCard;
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
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreatePaymentDto,
    companyId: string,
  ): Promise<PaymentResponse> {
    // Ambos validam empresa e existência, lançando 404 quando não pertencem a ela.
    // O detalhe traz a origem do agendamento, usada na checagem do pacote abaixo.
    const appointment = await this.appointmentService.findDetail(
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
    // Sessão de pacote já é cobrada pela contratação: um pagamento próprio
    // cobraria o cliente duas vezes (e travaria a sessão depois de concluída).
    if (appointment.recurringAppointment?.clientPlanId) {
      throw new ConflictException(
        "Sessão de pacote não recebe pagamento próprio: ela é cobrada pela contratação",
      );
    }
    if (dto.paymentMethodId) {
      await this.paymentMethodService.findOne(dto.paymentMethodId, companyId);
    }

    const status = dto.status ?? PaymentStatus.PENDING;
    this.ensurePaidAtMatchesStatus(status, dto.paidAt);
    ensurePaidAtIsNotFuture(dto.paidAt);
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
      throw mapUniqueViolation(error);
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
      // O cliente vem do agendamento, da contratação ou da venda.
      filters.push(clientWhere(clientId));
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
      items: items.map((payment) =>
        this.toResponse(this.toListItem(payment), today),
      ),
      total,
      page,
      limit,
    };
  }

  /**
   * Resumo da tela de Pagamentos: atrasado, a vencer e pago, no fuso da empresa.
   * Só o cliente e o período de vencimento filtram; status e demais filtros da
   * listagem são ignorados, pois os cartões são os próprios status. Com período,
   * os três usam o vencimento nele (inclusive os pagos) e pagamento sem
   * vencimento fica de fora. Soma e contagem vêm do banco, sem carregar os
   * pagamentos.
   */
  async summary(
    { clientId, dueFrom, dueTo }: SummaryPaymentsQueryDto,
    companyId: string,
  ): Promise<PaymentSummary> {
    const today = await this.todayFor(companyId);
    const hasPeriod = Boolean(dueFrom || dueTo);

    const base: Prisma.PaymentWhereInput[] = [
      {
        ...ownedByCompany(companyId),
        deletedAt: null,
      },
    ];
    if (clientId) {
      base.push(clientWhere(clientId));
    }
    if (hasPeriod) {
      base.push({ dueDate: { gte: dueFrom, lte: dueTo } });
    }

    const cards: Prisma.PaymentWhereInput[] = [
      // Atrasado: pendente com vencimento antes de hoje.
      isOverdueWhere(today),
      // A vencer: pendente de hoje em diante; sem período, também o sem vencimento.
      {
        status: PaymentStatus.PENDING,
        OR: hasPeriod
          ? [{ dueDate: { gte: today } }]
          : [{ dueDate: { gte: today } }, { dueDate: null }],
      },
      { status: PaymentStatus.PAID },
    ];

    const [overdue, upcoming, paid] = await this.prisma.$transaction(
      cards.map((card) =>
        this.prisma.payment.aggregate({
          where: { AND: [...base, card] },
          _sum: { amount: true },
          _count: { _all: true },
        }),
      ),
    );

    return {
      overdue: this.toCard(overdue),
      upcoming: this.toCard(upcoming),
      paid: this.toCard(paid),
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

  /**
   * Edição do pagamento. O pago só é alterado pelo ADMIN (403 para os demais),
   * e a alteração grava a auditoria com o antes e o depois, na mesma transação.
   */
  async update(
    id: string,
    dto: UpdatePaymentDto,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<PaymentResponse> {
    const { companyId } = currentUser;
    const payment = await this.findOwned(id, companyId);
    if (payment.productSaleId) {
      throw new ConflictException(SALE_PAYMENT_PROTECTED);
    }
    const wasPaid = payment.status === PaymentStatus.PAID;
    this.ensureCanChangePaid(payment, currentUser);

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

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.payment.update({
        where: { id },
        data: { ...dto, paidAt, updatedAt: new Date() },
      });
      if (wasPaid) {
        await this.auditService.record(
          {
            companyId,
            userId: currentUser.id,
            action: AuditAction.PAYMENT_PAID_UPDATED,
            entityType: "PAYMENT",
            entityId: id,
            ip,
            details: {
              before: auditSnapshot(payment),
              after: auditSnapshot(saved),
            },
          },
          tx,
        );
      }
      return saved;
    });

    return this.toResponse(updated, await this.todayFor(companyId));
  }

  /**
   * Exclusão lógica. A do pagamento pago é só do ADMIN e grava a auditoria com
   * o que foi excluído.
   */
  async remove(
    id: string,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<void> {
    const { companyId } = currentUser;
    const payment = await this.findOwned(id, companyId);
    if (payment.productSaleId) {
      throw new ConflictException(SALE_PAYMENT_PROTECTED);
    }
    this.ensureCanChangePaid(payment, currentUser);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id },
        data: { deletedAt: now, updatedAt: now },
      });
      if (payment.status === PaymentStatus.PAID) {
        await this.auditService.record(
          {
            companyId,
            userId: currentUser.id,
            action: AuditAction.PAYMENT_PAID_REMOVED,
            entityType: "PAYMENT",
            entityId: id,
            ip,
            details: { before: auditSnapshot(payment) },
          },
          tx,
        );
      }
    });
  }

  // Pagamento pago: só o ADMIN altera ou exclui.
  private ensureCanChangePaid(
    payment: Payment,
    currentUser: AuthenticatedUser,
  ): void {
    if (
      payment.status === PaymentStatus.PAID &&
      currentUser.type !== UserType.ADMIN
    ) {
      throw new ForbiddenException(PAID_PAYMENT_ADMIN_ONLY);
    }
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
        dueDate: localDateOf(appointment.startAt, timeZone),
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
        dueDate: localDateOf(startAt, company.timezone),
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

  /**
   * Sessão de turma cancelada pela clínica: os pagamentos ainda PENDING dos
   * agendamentos cancelados nela também são cancelados (o PAID não muda: não há
   * reembolso). Roda na transação de quem cancela a sessão, depois dos agendamentos.
   */
  async cancelPendingForClassSession(
    db: PrismaClientLike,
    classSessionId: string,
  ): Promise<number> {
    const { count } = await db.payment.updateMany({
      where: {
        status: PaymentStatus.PENDING,
        deletedAt: null,
        appointment: { classSessionId, status: AppointmentStatus.CANCELLED },
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
        dueDate: localDateOf(startAt, timeZone),
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
    ensurePaidAtIsNotFuture(paidAt);
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

  private toCard(aggregate: {
    _sum: { amount: Decimal | null };
    _count: { _all: number };
  }): PaymentSummaryCard {
    return {
      total: (aggregate._sum.amount ?? new Decimal(0)).toFixed(2),
      count: aggregate._count._all,
    };
  }

  // Leva o cliente (do atendimento, da contratação ou da venda) para o nível
  // do pagamento.
  private toListItem(payment: PaymentWithOrigin) {
    const { appointment, clientPlan, productSale, ...rest } = payment;
    const { client: appointmentClient, ...appointmentRest } = appointment ?? {};
    const { client: planClient, ...planRest } = clientPlan ?? {};
    const { client: saleClient, ...saleRest } = productSale ?? {};

    return {
      ...rest,
      // Todo pagamento pertence a um agendamento, a uma contratação ou a uma venda.
      client: (appointmentClient ?? planClient ?? saleClient)!,
      appointment: appointment ? appointmentRest : null,
      clientPlan: clientPlan ? planRest : null,
      productSale: productSale ? saleRest : null,
    } as Omit<PaymentListItem, "isOverdue">;
  }

  // Hoje no calendário da empresa: é a referência do atraso.
  private async todayFor(companyId: string): Promise<Date> {
    const timeZone = await this.companyService.getTimeZone(companyId);

    return localDateOf(new Date(), timeZone);
  }

  // Genérico: a listagem passa o pagamento com a origem, e ela é mantida.
  private toResponse<T extends Payment>(
    payment: T,
    today: Date,
  ): T & { isOverdue: boolean } {
    return { ...payment, isOverdue: isOverdue(payment, today) };
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

  // Só um pagamento PAID tem data de pagamento (ver docs/business-rules/pagamentos.md).
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
}
