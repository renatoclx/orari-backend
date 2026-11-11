import { Injectable } from "@nestjs/common";
import { PaymentStatus } from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import type { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { periodOf } from "../../common/time/report-period";
import { localDateOf } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import type { ReceivablesDebtorsQueryDto } from "./dto/receivables-debtors-query.dto";
import type { ReceivablesQueryDto } from "./dto/receivables-query.dto";

const DAY_MS = 24 * 60 * 60 * 1000;

// Faixas de atraso em dias (a última não tem fim).
export const AGING_BUCKETS = [
  { key: "1-30", min: 1, max: 30 },
  { key: "31-60", min: 31, max: 60 },
  { key: "61-90", min: 61, max: 90 },
  { key: "90+", min: 91, max: Infinity },
] as const;
export type AgingKey = (typeof AGING_BUCKETS)[number]["key"];

// Meses do gráfico: os 5 anteriores, o atual e os 3 seguintes.
const MONTHS_BEFORE = 5;
const MONTHS_AFTER = 3;

export interface ReceivablesTotal {
  total: string;
  count: number;
}

export interface ReceivablesMonth {
  /** AAAA-MM, pelo vencimento. */
  month: string;
  paid: string;
  overdue: string;
  upcoming: string;
}

export interface ReceivablesSummary {
  open: ReceivablesTotal;
  overdue: ReceivablesTotal & { clients: number };
  received: ReceivablesTotal;
  // Do que venceu no período (até ontem), quanto segue pendente.
  default: { due: string; unpaid: string; rate: number | null };
  aging: (ReceivablesTotal & { key: AgingKey })[];
  months: ReceivablesMonth[];
}

export interface ReceivablesDebtor {
  id: string;
  name: string;
  photoUrl: string | null;
  phone: string | null;
  overdue: string;
  count: number;
  /** Vencimento mais antigo em atraso (AAAA-MM-DD). */
  oldestDueDate: string;
}

// Cliente do pagamento: o do agendamento ou o da contratação.
const clientSelect = {
  select: {
    id: true,
    name: true,
    photoUrl: true,
    contacts: {
      where: { isPrincipal: true, deletedAt: null },
      select: { phone: true },
      take: 1,
    },
  },
} as const;

type Amount = { amount: Decimal };
type Dated = Amount & { dueDate: Date };

const sum = (rows: Amount[]) =>
  rows.reduce((acc, row) => acc.plus(row.amount), new Decimal(0));
const totalOf = (rows: Amount[]): ReceivablesTotal => ({
  total: sum(rows).toFixed(2),
  count: rows.length,
});
// Dias de atraso: vencimento ontem = 1. As datas são de calendário (UTC 00:00).
const daysLate = (dueDate: Date, today: Date) =>
  Math.round((today.getTime() - dueDate.getTime()) / DAY_MS);
const monthKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
const dateString = (date: Date) => date.toISOString().slice(0, 10);

/** O atrasado (vencido antes de hoje) por faixa de dias, inclusive as vazias. */
export function agingOf(overdue: Dated[], today: Date) {
  return AGING_BUCKETS.map(({ key, min, max }) => {
    const rows = overdue.filter((row) => {
      const days = daysLate(row.dueDate, today);
      return days >= min && days <= max;
    });
    return { key, ...totalOf(rows) };
  });
}

/** Janela do gráfico mensal: [primeiro dia, primeiro dia depois do fim). */
export function monthsWindow(today: Date) {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month - MONTHS_BEFORE, 1)),
    end: new Date(Date.UTC(year, month + MONTHS_AFTER + 1, 1)),
  };
}

/**
 * Um ponto por mês da janela, pelo vencimento: pago, atrasado (pendente que
 * venceu antes de hoje) e a vencer. Meses sem nada entram zerados.
 */
export function monthlySeries(
  rows: (Dated & { status: PaymentStatus })[],
  today: Date,
): ReceivablesMonth[] {
  const { start } = monthsWindow(today);
  const points = Array.from(
    { length: MONTHS_BEFORE + 1 + MONTHS_AFTER },
    (_, index) => ({
      month: monthKey(
        new Date(
          Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1),
        ),
      ),
      paid: new Decimal(0),
      overdue: new Decimal(0),
      upcoming: new Decimal(0),
    }),
  );
  const byMonth = new Map(points.map((point) => [point.month, point]));

  for (const row of rows) {
    const point = byMonth.get(monthKey(row.dueDate));
    if (!point) continue;
    if (row.status === PaymentStatus.PAID)
      point.paid = point.paid.plus(row.amount);
    else if (row.dueDate < today)
      point.overdue = point.overdue.plus(row.amount);
    else point.upcoming = point.upcoming.plus(row.amount);
  }

  return points.map((point) => ({
    month: point.month,
    paid: point.paid.toFixed(2),
    overdue: point.overdue.toFixed(2),
    upcoming: point.upcoming.toFixed(2),
  }));
}

/**
 * Contas a receber da empresa (ver docs/business-rules/relatorios.md, "Contas a
 * receber"). Só leitura: tudo sai dos pagamentos, venham de atendimento,
 * recorrência ou contratação de plano.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
  ) {}

  async summary(
    { from, to }: ReceivablesQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<ReceivablesSummary> {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const period = periodOf(from, to, timeZone, now);
    const today = localDateOf(now, timeZone);
    // O mesmo período em datas de calendário, para comparar com o vencimento.
    const dueStart = localDateOf(period.start, timeZone);
    const dueEnd = localDateOf(period.end, timeZone);
    // A inadimplência só olha o que já venceu: até ontem.
    const dueUntil = dueEnd < today ? dueEnd : today;
    const window = monthsWindow(today);
    const base = { companyId, deletedAt: null };
    const settled = { in: [PaymentStatus.PAID, PaymentStatus.PENDING] };

    const [pending, received, dueInPeriod, inWindow] = await Promise.all([
      this.prisma.payment.findMany({
        where: { ...base, status: PaymentStatus.PENDING },
        select: {
          amount: true,
          dueDate: true,
          appointment: { select: { clientId: true } },
          clientPlan: { select: { clientId: true } },
          productSale: { select: { clientId: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: {
          ...base,
          status: PaymentStatus.PAID,
          paidAt: { gte: period.start, lt: period.end },
        },
        select: { amount: true },
      }),
      dueStart < dueUntil
        ? this.prisma.payment.findMany({
            where: {
              ...base,
              status: settled,
              dueDate: { gte: dueStart, lt: dueUntil },
            },
            select: { amount: true, status: true },
          })
        : Promise.resolve([]),
      this.prisma.payment.findMany({
        where: {
          ...base,
          status: settled,
          dueDate: { gte: window.start, lt: window.end },
        },
        select: { amount: true, status: true, dueDate: true },
      }),
    ]);

    const overdue = pending.filter(
      (row): row is typeof row & { dueDate: Date } =>
        row.dueDate !== null && row.dueDate < today,
    );
    const debtors = new Set(
      overdue.map(
        (row) =>
          row.appointment?.clientId ??
          row.clientPlan?.clientId ??
          row.productSale?.clientId,
      ),
    );
    const due = sum(dueInPeriod);
    const unpaid = sum(
      dueInPeriod.filter((row) => row.status === PaymentStatus.PENDING),
    );

    return {
      open: totalOf(pending),
      overdue: { ...totalOf(overdue), clients: debtors.size },
      received: totalOf(received),
      default: {
        due: due.toFixed(2),
        unpaid: unpaid.toFixed(2),
        rate: due.isZero() ? null : unpaid.div(due).toNumber(),
      },
      aging: agingOf(overdue, today),
      months: monthlySeries(
        inWindow.filter((row): row is typeof row & { dueDate: Date } =>
          Boolean(row.dueDate),
        ),
        today,
      ),
    };
  }

  /** Clientes com atraso, do maior valor para o menor (empate pelo nome). */
  async debtors(
    query: ReceivablesDebtorsQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<PaginatedResult<ReceivablesDebtor>> {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const today = localDateOf(now, timeZone);

    const overdue = await this.prisma.payment.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: PaymentStatus.PENDING,
        dueDate: { lt: today },
      },
      // Mais antigo primeiro: o primeiro de cada cliente é o vencimento mais antigo.
      orderBy: { dueDate: "asc" },
      select: {
        amount: true,
        dueDate: true,
        appointment: { select: { client: clientSelect } },
        clientPlan: { select: { client: clientSelect } },
        productSale: { select: { client: clientSelect } },
      },
    });

    // Também quem foi excluído do cadastro: a dívida continua.
    const byClient = new Map<
      string,
      Omit<ReceivablesDebtor, "overdue"> & { amount: Decimal }
    >();
    for (const row of overdue) {
      const client = (row.appointment?.client ??
        row.clientPlan?.client ??
        row.productSale?.client)!;
      const current = byClient.get(client.id);
      if (current) {
        current.amount = current.amount.plus(row.amount);
        current.count += 1;
        continue;
      }
      byClient.set(client.id, {
        id: client.id,
        name: client.name,
        photoUrl: client.photoUrl,
        phone: client.contacts[0]?.phone ?? null,
        amount: row.amount,
        count: 1,
        oldestDueDate: dateString(row.dueDate!),
      });
    }

    const search = query.search?.trim()
      ? normalizeForSearch(query.search)
      : null;
    const filtered = [...byClient.values()]
      .filter(
        (debtor) => !search || normalizeForSearch(debtor.name).includes(search),
      )
      .sort(
        (a, b) => b.amount.comparedTo(a.amount) || a.name.localeCompare(b.name),
      );

    const { page, limit } = query;
    return {
      items: filtered
        .slice((page - 1) * limit, page * limit)
        .map(({ amount, ...debtor }) => ({
          ...debtor,
          overdue: amount.toFixed(2),
        })),
      total: filtered.length,
      page,
      limit,
    };
  }
}
