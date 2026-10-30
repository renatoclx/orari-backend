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
import { SummaryPaymentsQueryDto } from "./dto/summary-payments-query.dto";
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
 * atendimento (data, serviço e se veio de recorrência) ou a contratação
 * (plano e modalidade), além do cliente e do método de pagamento. Lidos pela
 * chave, sem filtrar exclusão: o nome continua mesmo que a pessoa, o serviço ou
 * o plano mudem.
 */
const clientSelect = { select: { id: true, name: true } } as const;

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
} satisfies Prisma.PaymentInclude;

type PaymentWithOrigin = Prisma.PaymentGetPayload<{
  include: typeof withOrigin;
}>;

// O cliente sai no nível do pagamento (é o do atendimento ou o da contratação);
// a origem não o repete.
export type PaymentListItem = PaymentResponse &
  Omit<PaymentWithOrigin, "appointment" | "clientPlan"> & {
    client: { id: string; name: string };
    appointment: Omit<
      NonNullable<PaymentWithOrigin["appointment"]>,
      "client"
    > | null;
    clientPlan: Omit<
      NonNullable<PaymentWithOrigin["clientPlan"]>,
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

// Atendimentos que dão comanda ao cliente no dia: cancelado e não comparecimento ficam de fora.
const CHECKOUT_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.COMPLETED,
];

// Atendimento do dia, com quem atende e a origem (sessão de pacote tem clientPlanId).
const checkoutAppointmentSelect = {
  id: true,
  startAt: true,
  status: true,
  recurringAppointmentId: true,
  service: { select: { id: true, name: true } },
  professional: { select: { id: true, name: true } },
  recurringAppointment: { select: { clientPlanId: true } },
} satisfies Prisma.AppointmentSelect;

// Pagamento anterior: a origem identifica o atendimento ou a contratação.
const previousPaymentInclude = {
  paymentMethod: { select: { id: true, name: true } },
  appointment: {
    select: {
      id: true,
      clientId: true,
      startAt: true,
      recurringAppointmentId: true,
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

// Campos do pagamento que a comanda mostra, com o método quando pago.
type CheckoutPaymentRow = Pick<
  Payment,
  "id" | "amount" | "dueDate" | "status" | "paidAt"
> & { paymentMethod: { id: string; name: string } | null };
type PreviousPaymentRow = Prisma.PaymentGetPayload<{
  include: typeof previousPaymentInclude;
}>;

export type CheckoutPayment = CheckoutPaymentRow & { isOverdue: boolean };

export type CheckoutAppointment = Omit<
  Prisma.AppointmentGetPayload<{ select: typeof checkoutAppointmentSelect }>,
  "recurringAppointment"
> & {
  // Preenchido quando o atendimento é sessão de pacote (cobrada pela contratação).
  clientPlanId: string | null;
  // Pagamento do atendimento (não excluído nem cancelado); null se ainda não existe.
  payment: CheckoutPayment | null;
};

export type CheckoutPreviousPayment = CheckoutPayment & {
  appointment: Omit<
    NonNullable<PreviousPaymentRow["appointment"]>,
    "clientId"
  > | null;
  clientPlan: Omit<
    NonNullable<PreviousPaymentRow["clientPlan"]>,
    "clientId"
  > | null;
};

// Comanda do dia de um cliente: os atendimentos de hoje, o que ficou para trás e os totais.
export interface Checkout {
  client: { id: string; name: string };
  appointments: CheckoutAppointment[];
  previousPayments: CheckoutPreviousPayment[];
  todayPending: string;
  previousPending: string;
  paidToday: string;
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
    this.ensurePaidAtIsNotFuture(dto.paidAt);
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
      base.push({
        OR: [{ appointment: { clientId } }, { clientPlan: { clientId } }],
      });
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
    this.ensurePaidAtIsNotFuture(paidAt);
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
   * Comandas do dia, uma por cliente, a partir das visitas. "Dia" é hoje no
   * fuso da empresa. Tem comanda o cliente que:
   * - tem um atendimento que começa hoje em SCHEDULED, CONFIRMED, IN_PROGRESS
   *   ou COMPLETED (cancelado e não comparecimento ficam de fora); ou
   * - tem um pagamento PAID com paidAt hoje (a comanda paga continua na lista).
   * Cliente só com pendência, sem atendimento nem pagamento hoje, não entra.
   * Pessoa inativada continua aparecendo.
   *
   * A paginação é por cliente: primeiro se resolvem os clientes (busca e ordem
   * pelo nome, no banco) e só então se carregam os dados dos clientes da página.
   * Pagamento cancelado ou excluído nunca entra em lista nem total.
   */
  async findCheckouts(
    { page, limit, search }: FindCheckoutsQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<Checkout>> {
    const { today, start, end } = await this.todayBounds(companyId);
    const paidToday = {
      deletedAt: null,
      status: PaymentStatus.PAID,
      paidAt: { gte: start, lt: end },
    };

    const clientsWhere: Prisma.PeopleWhereInput = {
      companyId,
      normalizedName: search
        ? { contains: normalizeForSearch(search) }
        : undefined,
      OR: [
        {
          appointmentsAsClient: {
            some: {
              startAt: { gte: start, lt: end },
              status: { in: CHECKOUT_APPOINTMENT_STATUSES },
            },
          },
        },
        { appointmentsAsClient: { some: { payment: { is: paidToday } } } },
        { clientPlans: { some: { payments: { some: paidToday } } } },
      ],
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
    if (clients.length === 0) {
      return { items: [], total, page, limit };
    }
    const pageIds = clients.map((client) => client.id);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        companyId,
        clientId: { in: pageIds },
        startAt: { gte: start, lt: end },
        status: { in: CHECKOUT_APPOINTMENT_STATUSES },
      },
      select: { ...checkoutAppointmentSelect, clientId: true },
      orderBy: { startAt: "asc" },
    });
    const appointmentIds = appointments.map((appointment) => appointment.id);

    // Dos atendimentos de hoje vem qualquer pagamento ativo; os demais entram
    // pelas três regras de "anteriores".
    const payments = await this.prisma.payment.findMany({
      where: {
        ...ownedByCompany(companyId),
        deletedAt: null,
        status: { not: PaymentStatus.CANCELLED },
        AND: [
          {
            OR: [
              { appointment: { clientId: { in: pageIds } } },
              { clientPlan: { clientId: { in: pageIds } } },
            ],
          },
          {
            OR: [
              { appointmentId: { in: appointmentIds } },
              { status: PaymentStatus.PENDING, dueDate: { lte: today } },
              {
                status: PaymentStatus.PENDING,
                dueDate: null,
                clientPlan: { billingType: PlanBillingType.INTEGRAL },
              },
              { status: PaymentStatus.PAID, paidAt: { gte: start, lt: end } },
            ],
          },
        ],
      },
      include: previousPaymentInclude,
      // Vencimento crescente, sem vencimento por último.
      orderBy: [
        { dueDate: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
    });
    const byAppointment = new Map(
      payments
        .filter((payment) => payment.appointmentId !== null)
        .map((payment) => [payment.appointmentId!, payment]),
    );
    const isToday = (paidAt: Date | null) =>
      paidAt !== null && paidAt >= start && paidAt < end;

    // Agrupa uma única vez por cliente: filtrar as listas inteiras a cada cliente
    // da página custaria clientes × atendimentos × pagamentos.
    const visitsByClient = this.groupBy(
      appointments,
      (appointment) => appointment.clientId,
    );
    const visitIds = new Set(appointmentIds);
    const previousByClient = this.groupBy(
      payments.filter(
        (payment) =>
          !payment.appointmentId || !visitIds.has(payment.appointmentId),
      ),
      (payment) =>
        (payment.appointment?.clientId ?? payment.clientPlan?.clientId)!,
    );

    const items = clients.map((client): Checkout => {
      const visits = (visitsByClient.get(client.id) ?? []).map(
        (appointment): CheckoutAppointment => {
          const payment = byAppointment.get(appointment.id);

          return {
            id: appointment.id,
            startAt: appointment.startAt,
            status: appointment.status,
            service: appointment.service,
            professional: appointment.professional,
            recurringAppointmentId: appointment.recurringAppointmentId,
            clientPlanId:
              appointment.recurringAppointment?.clientPlanId ?? null,
            payment: payment ? this.toCheckoutPayment(payment, today) : null,
          };
        },
      );

      const previous = previousByClient.get(client.id) ?? [];
      const visitPayments = visits.flatMap((visit) =>
        visit.payment ? [visit.payment] : [],
      );
      const pending = (rows: { status: PaymentStatus; amount: Decimal }[]) =>
        this.sum(rows.filter((row) => row.status === PaymentStatus.PENDING));

      return {
        client,
        appointments: visits,
        previousPayments: previous.map((payment) =>
          this.toPreviousPayment(payment, today),
        ),
        todayPending: pending(visitPayments).toFixed(2),
        previousPending: pending(previous).toFixed(2),
        paidToday: this.sum(
          [...visitPayments, ...previous].filter(
            (payment) =>
              payment.status === PaymentStatus.PAID && isToday(payment.paidAt),
          ),
        ).toFixed(2),
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
    this.ensurePaidAtIsNotFuture(paidAt);

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

      if (
        payments.some((payment) => payment.status !== PaymentStatus.PENDING)
      ) {
        throw new ConflictException(
          "Só é possível dar baixa em pagamentos pendentes",
        );
      }
      const clients = new Set(
        payments.map(
          (payment) =>
            payment.appointment?.clientId ?? payment.clientPlan?.clientId,
        ),
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

  /**
   * "Hoje" no fuso da empresa: a data de calendário (para comparar com o
   * vencimento) e o intervalo do dia em instantes UTC [start, end) (para
   * comparar com o início do atendimento e com o paidAt).
   */
  private async todayBounds(companyId: string) {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const today = this.toLocalDate(new Date(), timeZone);
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

    return {
      today,
      start: dayStart(today.getUTCDate()),
      end: dayStart(today.getUTCDate() + 1),
    };
  }

  // Campos do pagamento na comanda, com o atraso calculado.
  private toCheckoutPayment(
    payment: CheckoutPaymentRow,
    today: Date,
  ): CheckoutPayment {
    const { id, amount, dueDate, status, paidAt, paymentMethod } = payment;

    return {
      id,
      amount,
      dueDate,
      status,
      paidAt,
      paymentMethod,
      isOverdue: this.isOverdue(payment, today),
    };
  }

  // Pagamento anterior: os campos da comanda mais a origem (sem o clientId interno).
  private toPreviousPayment(
    payment: PreviousPaymentRow,
    today: Date,
  ): CheckoutPreviousPayment {
    const { appointment, clientPlan } = payment;

    return {
      ...this.toCheckoutPayment(payment, today),
      appointment: appointment
        ? {
            id: appointment.id,
            startAt: appointment.startAt,
            recurringAppointmentId: appointment.recurringAppointmentId,
            service: appointment.service,
          }
        : null,
      clientPlan: clientPlan
        ? {
            id: clientPlan.id,
            billingType: clientPlan.billingType,
            plan: clientPlan.plan,
          }
        : null,
    };
  }

  // Agrupa os itens pela chave, mantendo a ordem em que chegaram.
  private groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const item of items) {
      const key = keyOf(item);
      const group = groups.get(key);
      if (group) {
        group.push(item);
      } else {
        groups.set(key, [item]);
      }
    }

    return groups;
  }

  private sum(payments: { amount: Decimal }[]): Decimal {
    return payments.reduce((acc, p) => acc.plus(p.amount), new Decimal(0));
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

  // Leva o cliente (do atendimento ou da contratação) para o nível do pagamento.
  private toListItem(payment: PaymentWithOrigin) {
    const { appointment, clientPlan, ...rest } = payment;
    const { client: appointmentClient, ...appointmentRest } = appointment ?? {};
    const { client: planClient, ...planRest } = clientPlan ?? {};

    return {
      ...rest,
      // Todo pagamento pertence a um agendamento ou a uma contratação.
      client: (appointmentClient ?? planClient)!,
      appointment: appointment ? appointmentRest : null,
      clientPlan: clientPlan ? planRest : null,
    } as Omit<PaymentListItem, "isOverdue">;
  }

  // A baixa registra um pagamento que já aconteceu: data futura não faz sentido.
  // Data passada é aceita, para lançar uma baixa esquecida.
  private ensurePaidAtIsNotFuture(paidAt?: Date) {
    if (paidAt && paidAt.getTime() > Date.now()) {
      throw new BadRequestException("paidAt não pode estar no futuro");
    }
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
  private isOverdue(
    { status, dueDate }: { status: PaymentStatus; dueDate: Date | null },
    today: Date,
  ): boolean {
    return (
      status === PaymentStatus.PENDING && dueDate !== null && dueDate < today
    );
  }

  // Genérico: a listagem passa o pagamento com a origem, e ela é mantida.
  private toResponse<T extends Payment>(
    payment: T,
    today: Date,
  ): T & { isOverdue: boolean } {
    return { ...payment, isOverdue: this.isOverdue(payment, today) };
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
