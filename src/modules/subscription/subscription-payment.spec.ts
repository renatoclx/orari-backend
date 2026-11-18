import { describe, expect, it } from "vitest";
import {
  addMonths,
  suggestPayment,
  type PaymentBasis,
} from "./subscription-payment";

const d = (value: string) => new Date(`${value}T00:00:00Z`);
const basis = (extra: Partial<PaymentBasis> = {}): PaymentBasis => ({
  cycle: "MONTHLY",
  price: 89.9,
  discountPercent: null,
  discountUntil: null,
  trialEndsAt: null,
  paidUntil: null,
  ...extra,
});

describe("addMonths", () => {
  it("mesmo dia, ou o último do mês quando ele não existe", () => {
    expect(addMonths(d("2026-11-17"), 1)).toEqual(d("2026-12-17"));
    expect(addMonths(d("2026-01-31"), 1)).toEqual(d("2026-02-28"));
    expect(addMonths(d("2026-12-10"), 12)).toEqual(d("2027-12-10"));
  });
});

describe("suggestPayment", () => {
  it("continua do dia seguinte ao pago até (ativa ou na tolerância)", () => {
    const result = suggestPayment(
      basis({ paidUntil: d("2026-12-16") }),
      d("2026-12-20"),
    );
    expect(result).toEqual({
      periodStart: d("2026-12-17"),
      periodEnd: d("2027-01-16"),
      amount: 89.9,
    });
  });

  it("durante o teste, começa no dia seguinte ao fim do teste", () => {
    expect(
      suggestPayment(basis({ trialEndsAt: d("2026-11-23") }), d("2026-11-20"))
        .periodStart,
    ).toEqual(d("2026-11-24"));
  });

  it("bloqueada há tempo: começa hoje", () => {
    expect(
      suggestPayment(basis({ paidUntil: d("2026-10-01") }), d("2026-12-20"))
        .periodStart,
    ).toEqual(d("2026-12-20"));
  });

  it("anual: 12 meses; o desconto vale se o período começa até o fim dele", () => {
    const result = suggestPayment(
      basis({
        cycle: "ANNUAL",
        price: 898.8,
        discountPercent: 50,
        discountUntil: d("2026-12-01"),
      }),
      d("2026-12-01"),
    );
    expect(result).toEqual({
      periodStart: d("2026-12-01"),
      periodEnd: d("2027-11-30"),
      amount: 449.4,
    });
  });
});
