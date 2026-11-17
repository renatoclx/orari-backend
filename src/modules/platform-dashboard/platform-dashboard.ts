import type {
  BillingCycle,
  SubscriptionPlan,
} from "../../../generated/prisma/enums";
import {
  addDays,
  subscriptionState,
  type SubscriptionDates,
  type SubscriptionStatus,
} from "../subscription/subscription-status";
import { CYCLE_MONTHS } from "../subscription/subscription-payment";

/**
 * Números do painel do SUPER_ADMIN (ver docs/business-rules/empresa-e-acesso.md,
 * "Painel da plataforma"). Função pura: o serviço junta os dados do banco e
 * o "hoje"; aqui ficam as contas.
 */

/** Janela do "precisa de atenção": testes acabando e renovações chegando. */
export const TRIAL_ENDING_DAYS = 7;
export const RENEWAL_DAYS = 14;
/** Empresa sem nenhum agendamento criado há este tempo é "parada". */
export const IDLE_DAYS = 14;

export interface DashboardSubscription extends SubscriptionDates {
  plan: SubscriptionPlan;
  cycle: BillingCycle;
  price: number;
  discountPercent: number | null;
  discountUntil: Date | null;
}

export interface DashboardCompany {
  id: string;
  name: string;
  /** Mês de cadastro no fuso da plataforma ("AAAA-MM"). */
  createdMonth: string;
  /** "Hoje" no fuso da empresa (coluna `date`, UTC 00:00). */
  today: Date;
  subscription: DashboardSubscription | null;
}

export interface CompanyUsage {
  appointments30d: number;
  lastActivityAt: Date | null;
  clients: number;
  professionals: number;
}

export interface DashboardInput {
  companies: DashboardCompany[];
  usage: Map<string, CompanyUsage>;
  /** Agendamentos criados por mês ("AAAA-MM"), só os meses com algum. */
  appointmentsByMonth: Map<string, number>;
  /** Recebido por mês ("AAAA-MM", pela data do pagamento), só os meses com algum. */
  receivedByMonth: Map<string, number>;
  /** Os 12 meses do gráfico, do mais antigo ao atual ("AAAA-MM"). */
  months: string[];
  now: Date;
}

type StatusKey = SubscriptionStatus | "NONE";

interface AttentionItem {
  companyId: string;
  companyName: string;
  /** Fim do teste, último dia antes do bloqueio ou vencimento ("AAAA-MM-DD"). */
  date: string;
}

export interface PlatformDashboard {
  revenue: {
    /** Receita mensal recorrente: o equivalente mensal das pagantes, com desconto vigente. */
    mrr: number;
    /** O mesmo sem os descontos: a diferença é o custo das ofertas. */
    mrrWithoutDiscount: number;
    arr: number;
    payingCompanies: number;
    /** Valor dos ciclos vencidos ainda na tolerância. */
    overdueAmount: number;
  };
  trialConversion: { ended: number; converted: number };
  byStatus: { status: StatusKey; companies: number }[];
  byPlan: { plan: SubscriptionPlan; companies: number; mrr: number }[];
  byCycle: { cycle: BillingCycle; companies: number }[];
  companiesByMonth: { month: string; count: number }[];
  appointmentsByMonth: { month: string; count: number }[];
  /** Receita realizada: os pagamentos registrados em Cobranças. */
  receivedByMonth: { month: string; amount: number }[];
  attention: {
    trialsEnding: AttentionItem[];
    overdue: AttentionItem[];
    renewals: AttentionItem[];
    idle: {
      companyId: string;
      companyName: string;
      lastActivityAt: string | null;
    }[];
  };
  usage: {
    companyId: string;
    companyName: string;
    status: StatusKey;
    plan: SubscriptionPlan | null;
    appointments30d: number;
    clients: number;
    professionals: number;
    lastActivityAt: string | null;
  }[];
}

const STATUS_ORDER: StatusKey[] = [
  "TRIAL",
  "ACTIVE",
  "OVERDUE",
  "READ_ONLY",
  "CANCELED",
  "NONE",
];
const PLAN_ORDER: SubscriptionPlan[] = ["ESSENTIAL", "PLUS", "CLINICAL"];
const CYCLE_ORDER: BillingCycle[] = ["MONTHLY", "SEMIANNUAL", "ANNUAL"];
const NO_USAGE: CompanyUsage = {
  appointments30d: 0,
  lastActivityAt: null,
  clients: 0,
  professionals: 0,
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const dateText = (date: Date) => date.toISOString().slice(0, 10);

/** Equivalente mensal do ciclo, com o desconto se ainda vale hoje. */
export function monthlyValue(
  subscription: DashboardSubscription,
  today: Date,
  withDiscount = true,
): number {
  const monthly = subscription.price / CYCLE_MONTHS[subscription.cycle];
  const discountActive =
    withDiscount &&
    subscription.discountPercent !== null &&
    subscription.discountUntil !== null &&
    today <= subscription.discountUntil;
  return discountActive
    ? monthly * (1 - subscription.discountPercent! / 100)
    : monthly;
}

export function buildPlatformDashboard(
  input: DashboardInput,
): PlatformDashboard {
  const { companies, usage, now } = input;
  const statusCount = new Map<StatusKey, number>();
  const plans = new Map<SubscriptionPlan, { companies: number; mrr: number }>();
  const cycles = new Map<BillingCycle, number>();
  const revenue = {
    mrr: 0,
    mrrWithoutDiscount: 0,
    payingCompanies: 0,
    overdueAmount: 0,
  };
  const trialConversion = { ended: 0, converted: 0 };
  const attention: PlatformDashboard["attention"] = {
    trialsEnding: [],
    overdue: [],
    renewals: [],
    idle: [],
  };
  const idleSince = addDays(now, -IDLE_DAYS);
  const rows: PlatformDashboard["usage"] = [];

  for (const company of companies) {
    const subscription = company.subscription;
    const state = subscription
      ? subscriptionState(subscription, company.today)
      : null;
    const status: StatusKey = state?.status ?? "NONE";
    statusCount.set(status, (statusCount.get(status) ?? 0) + 1);
    const item = (date: Date): AttentionItem => ({
      companyId: company.id,
      companyName: company.name,
      date: dateText(date),
    });

    if (subscription && state) {
      const paying = status === "ACTIVE" || status === "OVERDUE";
      if (paying) {
        const mrr = monthlyValue(subscription, company.today);
        revenue.mrr += mrr;
        revenue.mrrWithoutDiscount += monthlyValue(
          subscription,
          company.today,
          false,
        );
        revenue.payingCompanies += 1;
        const plan = plans.get(subscription.plan) ?? { companies: 0, mrr: 0 };
        plans.set(subscription.plan, {
          companies: plan.companies + 1,
          mrr: plan.mrr + mrr,
        });
        cycles.set(
          subscription.cycle,
          (cycles.get(subscription.cycle) ?? 0) + 1,
        );
      }
      // Teste encerrado: converteu se chegou a ter um pagamento.
      if (
        subscription.trialEndsAt &&
        subscription.trialEndsAt < company.today
      ) {
        trialConversion.ended += 1;
        if (subscription.paidUntil) trialConversion.converted += 1;
      }
      if (
        status === "TRIAL" &&
        state.endsAt &&
        state.endsAt <= addDays(company.today, TRIAL_ENDING_DAYS)
      ) {
        attention.trialsEnding.push(item(state.endsAt));
      }
      if (status === "OVERDUE" && state.endsAt) {
        attention.overdue.push(item(state.endsAt));
        revenue.overdueAmount += subscription.price;
      }
      if (
        status === "ACTIVE" &&
        state.endsAt &&
        state.endsAt <= addDays(company.today, RENEWAL_DAYS)
      ) {
        attention.renewals.push(item(state.endsAt));
      }
    }

    const used = usage.get(company.id) ?? NO_USAGE;
    // Parada: pode usar (sem bloqueio) e não cria agendamento há 14 dias.
    const canWork = status !== "READ_ONLY" && status !== "CANCELED";
    if (canWork && (!used.lastActivityAt || used.lastActivityAt < idleSince)) {
      attention.idle.push({
        companyId: company.id,
        companyName: company.name,
        lastActivityAt: used.lastActivityAt?.toISOString() ?? null,
      });
    }
    rows.push({
      companyId: company.id,
      companyName: company.name,
      status,
      plan: subscription?.plan ?? null,
      appointments30d: used.appointments30d,
      clients: used.clients,
      professionals: used.professionals,
      lastActivityAt: used.lastActivityAt?.toISOString() ?? null,
    });
  }

  const byDate = (a: AttentionItem, b: AttentionItem) =>
    a.date.localeCompare(b.date);
  attention.trialsEnding.sort(byDate);
  attention.overdue.sort(byDate);
  attention.renewals.sort(byDate);
  // Parada há mais tempo (ou nunca usou) primeiro.
  attention.idle.sort((a, b) =>
    (a.lastActivityAt ?? "").localeCompare(b.lastActivityAt ?? ""),
  );

  const createdByMonth = new Map<string, number>();
  for (const { createdMonth } of companies) {
    createdByMonth.set(
      createdMonth,
      (createdByMonth.get(createdMonth) ?? 0) + 1,
    );
  }

  return {
    revenue: {
      mrr: round2(revenue.mrr),
      mrrWithoutDiscount: round2(revenue.mrrWithoutDiscount),
      arr: round2(revenue.mrr * 12),
      payingCompanies: revenue.payingCompanies,
      overdueAmount: round2(revenue.overdueAmount),
    },
    trialConversion,
    byStatus: STATUS_ORDER.map((status) => ({
      status,
      companies: statusCount.get(status) ?? 0,
    })),
    byPlan: PLAN_ORDER.map((plan) => ({
      plan,
      companies: plans.get(plan)?.companies ?? 0,
      mrr: round2(plans.get(plan)?.mrr ?? 0),
    })),
    byCycle: CYCLE_ORDER.map((cycle) => ({
      cycle,
      companies: cycles.get(cycle) ?? 0,
    })),
    companiesByMonth: input.months.map((month) => ({
      month,
      count: createdByMonth.get(month) ?? 0,
    })),
    appointmentsByMonth: input.months.map((month) => ({
      month,
      count: input.appointmentsByMonth.get(month) ?? 0,
    })),
    receivedByMonth: input.months.map((month) => ({
      month,
      amount: round2(input.receivedByMonth.get(month) ?? 0),
    })),
    attention,
    // Quem mais usa primeiro.
    usage: rows.sort((a, b) => b.appointments30d - a.appointments30d),
  };
}

/** Os 12 meses até o de `today`, do mais antigo ao atual ("AAAA-MM"). */
export function lastTwelveMonths(today: Date): string[] {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 11 + index, 1));
    return date.toISOString().slice(0, 7);
  });
}
