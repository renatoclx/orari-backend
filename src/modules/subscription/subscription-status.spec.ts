import { describe, expect, it } from "vitest";
import { cancellationDate, subscriptionState } from "./subscription-status";

const d = (value: string) => new Date(`${value}T00:00:00Z`);
const none = { trialEndsAt: null, paidUntil: null, canceledAt: null };

describe("subscriptionState", () => {
  it("em teste até o último dia do teste, inclusive", () => {
    const dates = { ...none, trialEndsAt: d("2026-12-10") };
    expect(subscriptionState(dates, d("2026-12-10"))).toEqual({
      status: "TRIAL",
      readOnly: false,
      endsAt: d("2026-12-10"),
    });
  });

  it("teste acabou sem pagamento: somente leitura, sem tolerância", () => {
    const dates = { ...none, trialEndsAt: d("2026-12-10") };
    expect(subscriptionState(dates, d("2026-12-11"))).toMatchObject({
      status: "READ_ONLY",
      readOnly: true,
    });
  });

  it("ativa até o vencimento; o pagamento vale mesmo durante o teste", () => {
    const dates = {
      ...none,
      trialEndsAt: d("2026-12-10"),
      paidUntil: d("2027-01-05"),
    };
    expect(subscriptionState(dates, d("2026-12-05"))).toMatchObject({
      status: "ACTIVE",
      endsAt: d("2027-01-05"),
    });
  });

  it("em atraso por 5 dias depois do vencimento, ainda gravando", () => {
    const dates = { ...none, paidUntil: d("2027-01-05") };
    expect(subscriptionState(dates, d("2027-01-06"))).toEqual({
      status: "OVERDUE",
      readOnly: false,
      endsAt: d("2027-01-10"),
    });
    expect(subscriptionState(dates, d("2027-01-10")).status).toBe("OVERDUE");
  });

  it("somente leitura a partir do 6º dia de atraso", () => {
    const dates = { ...none, paidUntil: d("2027-01-05") };
    expect(subscriptionState(dates, d("2027-01-11"))).toEqual({
      status: "READ_ONLY",
      readOnly: true,
      endsAt: null,
    });
  });

  it("cancelada a partir da data, mesmo com período pago", () => {
    const dates = {
      ...none,
      paidUntil: d("2027-01-05"),
      canceledAt: d("2026-12-20"),
    };
    expect(subscriptionState(dates, d("2026-12-19")).status).toBe("ACTIVE");
    expect(subscriptionState(dates, d("2026-12-20"))).toMatchObject({
      status: "CANCELED",
      readOnly: true,
    });
  });
});

describe("cancellationDate", () => {
  const today = d("2026-12-10");

  it("usa até o fim do que pagou: cancela no dia seguinte", () => {
    expect(
      cancellationDate(
        { trialEndsAt: null, paidUntil: d("2026-12-23") },
        today,
      ),
    ).toEqual(d("2026-12-24"));
  });

  it("em teste, sem pagamento: cancela no dia seguinte ao fim do teste", () => {
    expect(
      cancellationDate(
        { trialEndsAt: d("2026-12-15"), paidUntil: null },
        today,
      ),
    ).toEqual(d("2026-12-16"));
  });

  it("nada em andamento (já bloqueada ou vencida): vale hoje", () => {
    expect(
      cancellationDate(
        { trialEndsAt: d("2026-11-01"), paidUntil: d("2026-12-01") },
        today,
      ),
    ).toEqual(today);
  });
});
