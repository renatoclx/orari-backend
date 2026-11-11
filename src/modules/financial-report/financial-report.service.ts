import { Injectable, NotFoundException } from "@nestjs/common";
import { PaymentStatus } from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import type { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import {
  periodOf,
  seriesFrame,
  type Period,
} from "../../common/time/report-period";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import type {
  FinancialReportPaymentsQueryDto,
  FinancialReportQueryDto,
} from "./dto/financial-report-query.dto";

/** De onde veio o dinheiro: um atendimento ou uma contratação de pacote. */
export type ReceivedOrigin = "appointment" | "package";

/** O que o relatório lê de cada pagamento recebido. */
export interface ReceivedPayment {
  paidAt: Date;
  amount: Decimal;
  origin: ReceivedOrigin;
  method: { id: string; name: string } | null;
}

export interface ReceivedTotal {
  count: number;
  amount: string;
}

export interface FinancialReport {
  received: ReceivedTotal;
  appointments: ReceivedTotal;
  packages: ReceivedTotal;
  series: {
    unit: "day" | "week";
    /** `date`: primeiro dia do intervalo, AAAA-MM-DD no fuso da empresa. */
    points: { date: string; appointments: string; packages: string }[];
  };
  /** Do maior valor para o menor; `id` null: pagamento sem método. */
  byMethod: (ReceivedTotal & {
    id: string | null;
    name: string | null;
    share: number;
  })[];
}

export interface ReceivedItem {
  id: string;
  paidAt: Date;
  amount: string;
  origin: ReceivedOrigin;
  /** Serviço do atendimento ou nome do pacote. */
  description: string;
  client: { id: string; name: string };
  method: { id: string; name: string } | null;
}

const total = (count: number, amount: Decimal): ReceivedTotal => ({
  count,
  amount: amount.toFixed(2),
});

/**
 * Os números do relatório a partir dos pagamentos recebidos no período (função
 * pura). Tudo pela data do pagamento, no fuso da empresa.
 */
export function summarizeReceived(
  payments: ReceivedPayment[],
  period: Period,
  timeZone: string,
): FinancialReport {
  const frame = seriesFrame(period, timeZone);
  const points = frame.dates.map((date) => ({
    date,
    appointments: new Decimal(0),
    packages: new Decimal(0),
  }));
  const sums = {
    appointments: { count: 0, amount: new Decimal(0) },
    packages: { count: 0, amount: new Decimal(0) },
  };
  const methods = new Map<
    string,
    { id: string | null; name: string | null; count: number; amount: Decimal }
  >();

  for (const payment of payments) {
    const key = payment.origin === "package" ? "packages" : "appointments";
    sums[key].count += 1;
    sums[key].amount = sums[key].amount.plus(payment.amount);

    const point = points[frame.indexOf(payment.paidAt)];
    if (point) point[key] = point[key].plus(payment.amount);

    // Pagamento antigo pode estar sem método: fica numa linha própria.
    const methodKey = payment.method?.id ?? "";
    const method = methods.get(methodKey) ?? {
      id: payment.method?.id ?? null,
      name: payment.method?.name ?? null,
      count: 0,
      amount: new Decimal(0),
    };
    method.count += 1;
    method.amount = method.amount.plus(payment.amount);
    methods.set(methodKey, method);
  }

  const receivedAmount = sums.appointments.amount.plus(sums.packages.amount);
  return {
    received: total(
      sums.appointments.count + sums.packages.count,
      receivedAmount,
    ),
    appointments: total(sums.appointments.count, sums.appointments.amount),
    packages: total(sums.packages.count, sums.packages.amount),
    series: {
      unit: frame.unit,
      points: points.map((point) => ({
        date: point.date,
        appointments: point.appointments.toFixed(2),
        packages: point.packages.toFixed(2),
      })),
    },
    byMethod: [...methods.values()]
      .sort(
        (a, b) =>
          b.amount.comparedTo(a.amount) ||
          (a.name ?? "").localeCompare(b.name ?? ""),
      )
      .map(({ id, name, count, amount }) => ({
        id,
        name,
        ...total(count, amount),
        share: receivedAmount.isZero()
          ? 0
          : amount.div(receivedAmount).toNumber(),
      })),
  };
}

const person = { select: { id: true, name: true } } as const;

/**
 * Relatório financeiro: o que entrou no caixa (ver docs/business-rules/relatorios.md,
 * "Relatório financeiro"). Só leitura, pela data do pagamento.
 */
@Injectable()
export class FinancialReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
  ) {}

  async report(
    { from, to, paymentMethodId }: FinancialReportQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<FinancialReport> {
    const { where, period, timeZone } = await this.receivedWhere(
      { from, to, paymentMethodId },
      companyId,
      now,
    );
    const rows = await this.prisma.payment.findMany({
      where,
      select: {
        paidAt: true,
        amount: true,
        clientPlanId: true,
        paymentMethod: person,
      },
    });
    return summarizeReceived(
      rows.map((row) => ({
        // O filtro garante paidAt preenchido (só PAID).
        paidAt: row.paidAt!,
        amount: row.amount,
        origin: row.clientPlanId ? "package" : "appointment",
        method: row.paymentMethod,
      })),
      period,
      timeZone,
    );
  }

  /** Extrato do recebido: do pagamento mais recente para o mais antigo. */
  async payments(
    { from, to, paymentMethodId, page, limit }: FinancialReportPaymentsQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<PaginatedResult<ReceivedItem>> {
    const { where } = await this.receivedWhere(
      { from, to, paymentMethodId },
      companyId,
      now,
    );
    const [rows, count] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ paidAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          paidAt: true,
          amount: true,
          paymentMethod: person,
          appointment: { select: { client: person, service: person } },
          clientPlan: { select: { client: person, plan: person } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        paidAt: row.paidAt!,
        amount: row.amount.toFixed(2),
        origin: row.clientPlan ? "package" : "appointment",
        // Um pagamento é de um atendimento ou de uma contratação, nunca dos dois.
        description: row.clientPlan
          ? row.clientPlan.plan.name
          : (row.appointment?.service.name ?? ""),
        client: (row.clientPlan ?? row.appointment)!.client,
        method: row.paymentMethod,
      })),
      total: count,
      page,
      limit,
    };
  }

  // Filtro comum ao resumo e ao extrato: pagos, não excluídos, no período.
  private async receivedWhere(
    { from, to, paymentMethodId }: FinancialReportQueryDto,
    companyId: string,
    now: Date,
  ) {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const period = periodOf(from, to, timeZone, now);

    if (paymentMethodId) {
      const method = await this.prisma.paymentMethod.findFirst({
        where: { id: paymentMethodId, companyId },
        select: { id: true },
      });
      if (!method) {
        throw new NotFoundException("Método de pagamento não encontrado");
      }
    }

    return {
      timeZone,
      period,
      where: {
        companyId,
        status: PaymentStatus.PAID,
        deletedAt: null,
        paidAt: { gte: period.start, lt: period.end },
        paymentMethodId,
      },
    };
  }
}
