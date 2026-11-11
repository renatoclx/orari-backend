import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Payment, Prisma } from "../../../generated/prisma/client";
import {
  AppointmentStatus,
  PaymentStatus,
  PlanBillingType,
} from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { localDateOf, zonedToUtc } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { PaymentMethodService } from "../payment-method/payment-method.service";
import { FindCheckoutsQueryDto } from "./dto/find-checkouts-query.dto";
import { SettleCheckoutDto } from "./dto/settle-checkout.dto";
import {
  ensurePaidAtIsNotFuture,
  isOverdue,
  mapUniqueViolation,
  saleItemsSelect,
  sumAmounts,
} from "./payment-rules";

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
  // O preço é o valor de quem recebe antes da conclusão (sem pagamento ainda).
  service: { select: { id: true, name: true, price: true } },
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
  productSale: {
    select: {
      id: true,
      clientId: true,
      createdAt: true,
      items: saleItemsSelect,
    },
  },
} satisfies Prisma.PaymentInclude;

// Venda de hoje na comanda: itens e o pagamento (só as não canceladas).
const checkoutSaleSelect = {
  id: true,
  clientId: true,
  createdAt: true,
  items: saleItemsSelect,
  payment: {
    select: {
      id: true,
      amount: true,
      dueDate: true,
      status: true,
      paidAt: true,
      paymentMethod: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ProductSaleSelect;

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
  productSale: Omit<
    NonNullable<PreviousPaymentRow["productSale"]>,
    "clientId"
  > | null;
};

// Venda de produtos de hoje, com o pagamento dela.
export interface CheckoutProductSale {
  id: string;
  createdAt: Date;
  items: Prisma.ProductSaleItemGetPayload<typeof saleItemsSelect>[];
  payment: CheckoutPayment | null;
}

// Comanda do dia de um cliente: os atendimentos de hoje, o que ficou para trás e os totais.
export interface Checkout {
  client: { id: string; name: string };
  appointments: CheckoutAppointment[];
  // Vendas de produtos de hoje (não canceladas).
  productSales: CheckoutProductSale[];
  previousPayments: CheckoutPreviousPayment[];
  todayPending: string;
  previousPending: string;
  paidToday: string;
}

/**
 * Comanda do dia (ver docs/business-rules/pagamentos.md): a lista das comandas
 * por cliente e a baixa dos itens escolhidos. Separada do PaymentService, que
 * cuida do cadastro e do ciclo de vida de cada pagamento.
 */
@Injectable()
export class PaymentCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentMethodService: PaymentMethodService,
    private readonly companyService: CompanyService,
  ) {}

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
        // Comprou hoje (venda não cancelada) ou pagou hoje uma venda.
        {
          productSales: {
            some: { createdAt: { gte: start, lt: end }, cancelledAt: null },
          },
        },
        { productSales: { some: { payment: { is: paidToday } } } },
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
    const sales = await this.prisma.productSale.findMany({
      where: {
        companyId,
        clientId: { in: pageIds },
        createdAt: { gte: start, lt: end },
        cancelledAt: null,
      },
      select: checkoutSaleSelect,
      orderBy: { createdAt: "asc" },
    });
    const saleIds = new Set(sales.map((sale) => sale.id));

    // Dos atendimentos de hoje vem qualquer pagamento ativo; os demais entram
    // pelas três regras de "anteriores".
    const payments = await this.prisma.payment.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { not: PaymentStatus.CANCELLED },
        AND: [
          {
            OR: [
              { appointment: { clientId: { in: pageIds } } },
              { clientPlan: { clientId: { in: pageIds } } },
              { productSale: { clientId: { in: pageIds } } },
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
    // Anteriores: fora dos atendimentos e das vendas de hoje (que têm seção própria).
    const previousByClient = this.groupBy(
      payments.filter(
        (payment) =>
          (!payment.appointmentId || !visitIds.has(payment.appointmentId)) &&
          (!payment.productSaleId || !saleIds.has(payment.productSaleId)),
      ),
      (payment) =>
        (payment.appointment?.clientId ??
          payment.clientPlan?.clientId ??
          payment.productSale?.clientId)!,
    );
    const salesByClient = this.groupBy(sales, (sale) => sale.clientId);

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
      const productSales = (salesByClient.get(client.id) ?? []).map(
        (sale): CheckoutProductSale => ({
          id: sale.id,
          createdAt: sale.createdAt,
          items: sale.items,
          // O cancelado não aparece (a venda cancelada já está fora).
          payment:
            sale.payment && sale.payment.status !== PaymentStatus.CANCELLED
              ? this.toCheckoutPayment(sale.payment, today)
              : null,
        }),
      );
      // Os pagamentos de hoje: dos atendimentos e das vendas.
      const visitPayments = [
        ...visits.flatMap((visit) => (visit.payment ? [visit.payment] : [])),
        ...productSales.flatMap((sale) => (sale.payment ? [sale.payment] : [])),
      ];
      const pending = (rows: { status: PaymentStatus; amount: Decimal }[]) =>
        sumAmounts(rows.filter((row) => row.status === PaymentStatus.PENDING));

      return {
        client,
        appointments: visits,
        productSales,
        previousPayments: previous.map((payment) =>
          this.toPreviousPayment(payment, today),
        ),
        todayPending: pending(visitPayments).toFixed(2),
        previousPending: pending(previous).toFixed(2),
        paidToday: sumAmounts(
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
   * Baixa dos itens escolhidos, todos do mesmo cliente, com o mesmo método e a
   * mesma data. Além dos pagamentos pendentes, aceita atendimentos avulsos
   * ainda sem pagamento (receber antes da conclusão): cada um ganha um
   * pagamento PAID com o preço do serviço, e o job de conclusão não cobra de
   * novo (ele só pega atendimento sem pagamento). Tudo ou nada: a conferência e
   * a gravação rodam numa só transação. Erros: 404 (pagamento, atendimento ou
   * método inexistente na empresa), 409 (pagamento fora do PENDING; atendimento
   * cancelado, com falta, de pacote ou já com pagamento), 400 (nenhum item,
   * clientes diferentes ou serviço sem preço).
   */
  async settle(
    {
      paymentIds = [],
      appointmentIds = [],
      paymentMethodId,
      paidAt,
    }: SettleCheckoutDto,
    companyId: string,
  ): Promise<{ settled: number }> {
    ensurePaidAtIsNotFuture(paidAt);
    if (paymentIds.length + appointmentIds.length === 0) {
      throw new BadRequestException("Escolha ao menos um item para receber");
    }
    const timeZone = await this.companyService.getTimeZone(companyId);

    return this.prisma.$transaction(async (tx) => {
      const payments =
        paymentIds.length > 0
          ? await tx.payment.findMany({
              where: { id: { in: paymentIds }, deletedAt: null, companyId },
              select: {
                status: true,
                appointment: { select: { clientId: true } },
                clientPlan: { select: { clientId: true } },
                productSale: { select: { clientId: true } },
              },
            })
          : [];
      if (payments.length !== paymentIds.length) {
        throw new NotFoundException("Pagamento não encontrado");
      }
      const appointments =
        appointmentIds.length > 0
          ? await tx.appointment.findMany({
              where: { id: { in: appointmentIds }, companyId },
              select: {
                id: true,
                clientId: true,
                startAt: true,
                status: true,
                service: { select: { price: true } },
                recurringAppointment: { select: { clientPlanId: true } },
                payment: { select: { deletedAt: true } },
              },
            })
          : [];
      if (appointments.length !== appointmentIds.length) {
        throw new NotFoundException("Agendamento não encontrado");
      }
      await this.paymentMethodService.findOne(paymentMethodId, companyId);

      if (
        payments.some((payment) => payment.status !== PaymentStatus.PENDING)
      ) {
        throw new ConflictException(
          "Só é possível dar baixa em pagamentos pendentes",
        );
      }
      this.ensureReceivableAhead(appointments);
      const clients = new Set([
        ...payments.map(
          (payment) =>
            payment.appointment?.clientId ??
            payment.clientPlan?.clientId ??
            payment.productSale?.clientId,
        ),
        ...appointments.map((appointment) => appointment.clientId),
      ]);
      if (clients.size > 1) {
        throw new BadRequestException(
          "Os pagamentos precisam ser do mesmo cliente",
        );
      }

      const now = new Date();
      const settledAt = paidAt ?? now;
      // O status no filtro protege de uma baixa concorrente entre a leitura e a gravação.
      const { count } =
        paymentIds.length > 0
          ? await tx.payment.updateMany({
              where: {
                id: { in: paymentIds },
                status: PaymentStatus.PENDING,
                deletedAt: null,
                companyId,
              },
              data: {
                status: PaymentStatus.PAID,
                paymentMethodId,
                paidAt: settledAt,
                updatedAt: now,
              },
            })
          : { count: 0 };
      if (count !== paymentIds.length) {
        throw new ConflictException(
          "Só é possível dar baixa em pagamentos pendentes",
        );
      }

      // Vencimento no dia do atendimento, como o pagamento que o job geraria.
      // Um pagamento criado ao mesmo tempo por outra baixa (ou pelo job) cai na
      // unicidade por agendamento: 409, e a transação desfaz tudo.
      let created = 0;
      if (appointments.length > 0) {
        try {
          ({ count: created } = await tx.payment.createMany({
            data: appointments.map((appointment) => ({
              companyId,
              appointmentId: appointment.id,
              amount: appointment.service.price!,
              dueDate: localDateOf(appointment.startAt, timeZone),
              status: PaymentStatus.PAID,
              paymentMethodId,
              paidAt: settledAt,
            })),
          }));
        } catch (error) {
          throw mapUniqueViolation(error);
        }
      }

      return { settled: count + created };
    });
  }

  /**
   * Atendimento que pode ser recebido antes da conclusão: avulso (sessão de
   * pacote é cobrada pela contratação), não cancelado nem com falta, ainda sem
   * pagamento ativo e com preço no serviço (é o valor cobrado).
   */
  private ensureReceivableAhead(
    appointments: {
      status: AppointmentStatus;
      service: { price: Decimal | null };
      recurringAppointment: { clientPlanId: string | null } | null;
      payment: { deletedAt: Date | null } | null;
    }[],
  ) {
    for (const appointment of appointments) {
      if (
        appointment.status === AppointmentStatus.CANCELLED ||
        appointment.status === AppointmentStatus.NO_SHOW
      ) {
        throw new ConflictException(
          "Agendamento cancelado ou com falta não pode ser recebido",
        );
      }
      if (appointment.recurringAppointment?.clientPlanId) {
        throw new ConflictException(
          "Sessão de pacote não recebe pagamento próprio: ela é cobrada pela contratação",
        );
      }
      if (appointment.payment && appointment.payment.deletedAt === null) {
        throw new ConflictException("Este agendamento já possui um pagamento");
      }
      if (appointment.service.price === null) {
        throw new BadRequestException(
          "Serviço sem preço: o valor é lançado depois da conclusão",
        );
      }
    }
  }

  /**
   * "Hoje" no fuso da empresa: a data de calendário (para comparar com o
   * vencimento) e o intervalo do dia em instantes UTC [start, end) (para
   * comparar com o início do atendimento e com o paidAt).
   */
  private async todayBounds(companyId: string) {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const today = localDateOf(new Date(), timeZone);
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
      isOverdue: isOverdue(payment, today),
    };
  }

  // Pagamento anterior: os campos da comanda mais a origem (sem o clientId interno).
  private toPreviousPayment(
    payment: PreviousPaymentRow,
    today: Date,
  ): CheckoutPreviousPayment {
    const { appointment, clientPlan, productSale } = payment;

    return {
      ...this.toCheckoutPayment(payment, today),
      productSale: productSale
        ? {
            id: productSale.id,
            createdAt: productSale.createdAt,
            items: productSale.items,
          }
        : null,
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
}
