import { describe, expect, it } from "vitest";
import {
  buildPlatformDashboard,
  lastTwelveMonths,
  monthlyValue,
  type DashboardCompany,
  type DashboardInput,
  type DashboardSubscription,
} from "./platform-dashboard";

const d = (value: string) => new Date(`${value}T00:00:00Z`);
const TODAY = d("2026-12-15");
const NOW = new Date("2026-12-15T15:00:00Z");

const sub = (
  extra: Partial<DashboardSubscription> = {},
): DashboardSubscription => ({
  plan: "PLUS",
  cycle: "MONTHLY",
  price: 89.9,
  discountPercent: null,
  discountUntil: null,
  trialEndsAt: null,
  paidUntil: null,
  canceledAt: null,
  ...extra,
});

const company = (
  id: string,
  subscription: DashboardSubscription | null,
  createdMonth = "2026-11",
): DashboardCompany => ({
  id,
  name: id,
  createdMonth,
  today: TODAY,
  subscription,
});

const input = (
  companies: DashboardCompany[],
  extra: Partial<DashboardInput> = {},
): DashboardInput => ({
  companies,
  usage: new Map(),
  appointmentsByMonth: new Map(),
  months: lastTwelveMonths(TODAY),
  now: NOW,
  ...extra,
});

describe("monthlyValue", () => {
  it("divide o ciclo pelos meses e aplica o desconto só enquanto vale", () => {
    const annual = sub({ cycle: "ANNUAL", price: 1200 });
    expect(monthlyValue(annual, TODAY)).toBe(100);
    const discounted = sub({
      discountPercent: 50,
      discountUntil: d("2026-12-31"),
    });
    expect(monthlyValue(discounted, TODAY)).toBeCloseTo(44.95);
    expect(monthlyValue(discounted, d("2027-01-01"))).toBe(89.9);
  });
});

describe("buildPlatformDashboard", () => {
  const active = company("ativa", sub({ paidUntil: d("2026-12-20") }));
  const discounted = company(
    "promo",
    sub({
      plan: "ESSENTIAL",
      price: 44.9,
      paidUntil: d("2027-01-10"),
      discountPercent: 50,
      discountUntil: d("2027-03-01"),
      trialEndsAt: d("2026-12-01"),
    }),
  );
  const overdue = company("atrasada", sub({ paidUntil: d("2026-12-12") }));
  const trial = company(
    "teste",
    sub({ trialEndsAt: d("2026-12-18") }),
    "2026-12",
  );
  const lost = company("perdida", sub({ trialEndsAt: d("2026-12-01") }));
  const none = company("sem", null, "2026-12");

  const result = buildPlatformDashboard(
    input([active, discounted, overdue, trial, lost, none], {
      usage: new Map([
        [
          "ativa",
          {
            appointments30d: 40,
            lastActivityAt: new Date("2026-12-14T10:00:00Z"),
            clients: 30,
            professionals: 3,
          },
        ],
        [
          "teste",
          {
            appointments30d: 2,
            lastActivityAt: new Date("2026-11-20T10:00:00Z"),
            clients: 5,
            professionals: 1,
          },
        ],
      ]),
      appointmentsByMonth: new Map([["2026-12", 42]]),
    }),
  );

  it("MRR só das pagantes (ativas e em atraso), com e sem desconto", () => {
    // 89,90 (ativa) + 22,45 (promo, 50%) + 89,90 (em atraso).
    expect(result.revenue.mrr).toBe(202.25);
    expect(result.revenue.mrrWithoutDiscount).toBe(224.7);
    expect(result.revenue.arr).toBe(2427);
    expect(result.revenue.payingCompanies).toBe(3);
    expect(result.revenue.overdueAmount).toBe(89.9);
  });

  it("contagem por situação, plano e ciclo", () => {
    expect(result.byStatus).toEqual([
      { status: "TRIAL", companies: 1 },
      { status: "ACTIVE", companies: 2 },
      { status: "OVERDUE", companies: 1 },
      { status: "READ_ONLY", companies: 1 },
      { status: "CANCELED", companies: 0 },
      { status: "NONE", companies: 1 },
    ]);
    expect(result.byPlan).toEqual([
      { plan: "ESSENTIAL", companies: 1, mrr: 22.45 },
      { plan: "PLUS", companies: 2, mrr: 179.8 },
      { plan: "CLINICAL", companies: 0, mrr: 0 },
    ]);
    expect(result.byCycle[0]).toEqual({ cycle: "MONTHLY", companies: 3 });
  });

  it("conversão: testes encerrados e quantos pagaram", () => {
    expect(result.trialConversion).toEqual({ ended: 2, converted: 1 });
  });

  it("atenção: teste acabando, atraso, renovação e paradas", () => {
    expect(result.attention.trialsEnding.map((i) => i.companyId)).toEqual([
      "teste",
    ]);
    expect(result.attention.overdue).toEqual([
      { companyId: "atrasada", companyName: "atrasada", date: "2026-12-17" },
    ]);
    expect(result.attention.renewals.map((i) => i.companyId)).toEqual([
      "ativa",
    ]);
    // Somente leitura não entra; quem nunca usou vem primeiro.
    expect(result.attention.idle.map((i) => i.companyId)).toEqual([
      "promo",
      "atrasada",
      "sem",
      "teste",
    ]);
  });

  it("meses do gráfico com zeros e uso ordenado por agendamentos", () => {
    expect(result.companiesByMonth.at(-1)).toEqual({
      month: "2026-12",
      count: 2,
    });
    expect(result.companiesByMonth.at(-2)).toEqual({
      month: "2026-11",
      count: 4,
    });
    expect(result.appointmentsByMonth.at(-1)).toEqual({
      month: "2026-12",
      count: 42,
    });
    expect(result.appointmentsByMonth[0]).toEqual({
      month: "2026-01",
      count: 0,
    });
    expect(result.usage[0]).toMatchObject({
      companyId: "ativa",
      appointments30d: 40,
    });
  });
});

describe("lastTwelveMonths", () => {
  it("do mesmo mês do ano anterior +1 até o atual", () => {
    const months = lastTwelveMonths(d("2026-03-10"));
    expect(months[0]).toBe("2025-04");
    expect(months.at(-1)).toBe("2026-03");
    expect(months).toHaveLength(12);
  });
});
