import { describe, expect, it } from "vitest";
import {
  calculateDueDates,
  calculateEndDate,
  calculatePlanPricing,
} from "./client-plan.calculations";

// Decimal → texto com duas casas, para comparar valores sem depender do tipo.
const money = (values: { toFixed: (digits: number) => string }[]) =>
  values.map((value) => value.toFixed(2));

const day = (value: string) => new Date(value);
const days = (values: Date[]) =>
  values.map((value) => value.toISOString().slice(0, 10));

describe("calculatePlanPricing", () => {
  const period = { discountPercent: 10, monthlyDiscountPercent: 5 };

  it("integral: um pagamento com o total do período e o desconto integral", () => {
    const pricing = calculatePlanPricing({
      billingType: "INTEGRAL",
      months: 3,
      monthlyPrice: 400,
      ...period,
    });

    expect(pricing.discountPercent.toNumber()).toBe(10);
    expect(pricing.totalAmount.toFixed(2)).toBe("1080.00");
    expect(money(pricing.paymentAmounts)).toEqual(["1080.00"]);
  });

  it("mensal: uma parcela por mês com o desconto mensal", () => {
    const pricing = calculatePlanPricing({
      billingType: "MONTHLY",
      months: 3,
      monthlyPrice: 400,
      ...period,
    });

    expect(pricing.discountPercent.toNumber()).toBe(5);
    expect(pricing.totalAmount.toFixed(2)).toBe("1140.00");
    expect(money(pricing.paymentAmounts)).toEqual([
      "380.00",
      "380.00",
      "380.00",
    ]);
  });

  it("mensal: arredonda a parcela antes, para a soma fechar com o total", () => {
    // 333,33 com 7,5% = 308,33025 → 308,33; 3 × 308,33 = 924,99.
    const pricing = calculatePlanPricing({
      billingType: "MONTHLY",
      months: 3,
      monthlyPrice: "333.33",
      discountPercent: 0,
      monthlyDiscountPercent: "7.5",
    });

    expect(money(pricing.paymentAmounts)).toEqual([
      "308.33",
      "308.33",
      "308.33",
    ]);
    expect(pricing.totalAmount.toFixed(2)).toBe("924.99");
  });

  it("arredonda a metade para cima", () => {
    // 100,01 com 50% = 50,005 → 50,01.
    const pricing = calculatePlanPricing({
      billingType: "INTEGRAL",
      months: 1,
      monthlyPrice: "100.01",
      discountPercent: 50,
      monthlyDiscountPercent: 0,
    });

    expect(pricing.totalAmount.toFixed(2)).toBe("50.01");
  });

  it("não sofre com o erro de ponto flutuante", () => {
    // Em `number`, 0.1 * 3 dá 0.30000000000000004.
    const pricing = calculatePlanPricing({
      billingType: "INTEGRAL",
      months: 3,
      monthlyPrice: "0.10",
      discountPercent: 0,
      monthlyDiscountPercent: 0,
    });

    expect(pricing.totalAmount.toString()).toBe("0.3");
  });

  it("aceita desconto zero e desconto total", () => {
    const full = calculatePlanPricing({
      billingType: "MONTHLY",
      months: 2,
      monthlyPrice: 400,
      discountPercent: 0,
      monthlyDiscountPercent: 100,
    });

    expect(full.totalAmount.toFixed(2)).toBe("0.00");
  });
});

describe("calculateEndDate", () => {
  it("termina na véspera do mesmo dia, N meses depois", () => {
    expect(days([calculateEndDate(day("2026-10-15"), 3)])).toEqual([
      "2027-01-14",
    ]);
  });

  it("vira o ano quando necessário", () => {
    expect(days([calculateEndDate(day("2026-11-01"), 12)])).toEqual([
      "2027-10-31",
    ]);
  });

  it("vai até o último dia do mês quando o dia de início não existe nele", () => {
    // 31/01 + 1 mês: não há 31/02, então o cliente recebe fevereiro inteiro.
    expect(days([calculateEndDate(day("2027-01-31"), 1)])).toEqual([
      "2027-02-28",
    ]);
    // 30/11 + 3 meses: não há 30/02.
    expect(days([calculateEndDate(day("2026-11-30"), 3)])).toEqual([
      "2027-02-28",
    ]);
  });

  it("considera ano bissexto", () => {
    expect(days([calculateEndDate(day("2028-01-31"), 1)])).toEqual([
      "2028-02-29",
    ]);
    expect(days([calculateEndDate(day("2028-01-29"), 1)])).toEqual([
      "2028-02-28",
    ]);
  });
});

describe("calculateDueDates", () => {
  it("gera um vencimento por mês no mesmo dia", () => {
    expect(days(calculateDueDates(day("2026-11-10"), 3))).toEqual([
      "2026-11-10",
      "2026-12-10",
      "2027-01-10",
    ]);
  });

  it("usa o último dia do mês sem puxar os vencimentos seguintes", () => {
    expect(days(calculateDueDates(day("2027-01-31"), 4))).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("gera um único vencimento no integral", () => {
    expect(days(calculateDueDates(day("2026-10-20"), 1))).toEqual([
      "2026-10-20",
    ]);
  });
});
