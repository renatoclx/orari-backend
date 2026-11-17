import type { BillingCycle } from "../../../generated/prisma/enums";
import { addDays, GRACE_DAYS } from "./subscription-status";

/**
 * Sugestão do próximo pagamento da assinatura (ver
 * docs/business-rules/empresa-e-acesso.md, "Cobranças"). Função pura: o
 * "hoje" vem de fora, no fuso da empresa (coluna `date`, UTC 00:00).
 */

export const CYCLE_MONTHS: Record<BillingCycle, number> = {
  MONTHLY: 1,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

export interface PaymentBasis {
  cycle: BillingCycle;
  price: number;
  discountPercent: number | null;
  discountUntil: Date | null;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
}

export interface PaymentSuggestion {
  periodStart: Date;
  periodEnd: Date;
  amount: number;
}

/**
 * Mesmo dia N meses depois; sem esse dia no mês (31 → fevereiro), o último
 * dia do mês.
 */
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

/**
 * Onde começa o próximo período: no dia seguinte ao "pago até" enquanto ele
 * ainda vale ou está na tolerância (a cobrança não perde dias); no dia
 * seguinte ao teste, se ele ainda corre; senão, hoje (quem voltou depois do
 * bloqueio começa de novo).
 */
export function nextPeriodStart(basis: PaymentBasis, today: Date): Date {
  if (basis.paidUntil && today <= addDays(basis.paidUntil, GRACE_DAYS)) {
    return addDays(basis.paidUntil, 1);
  }
  if (basis.trialEndsAt && today <= basis.trialEndsAt) {
    return addDays(basis.trialEndsAt, 1);
  }
  return today;
}

/** Período de um ciclo a partir do início, e o valor com o desconto que valer nele. */
export function suggestPayment(
  basis: PaymentBasis,
  today: Date,
): PaymentSuggestion {
  const periodStart = nextPeriodStart(basis, today);
  const periodEnd = addDays(
    addMonths(periodStart, CYCLE_MONTHS[basis.cycle]),
    -1,
  );
  const discounted =
    basis.discountPercent !== null &&
    basis.discountUntil !== null &&
    periodStart <= basis.discountUntil;
  const amount = discounted
    ? basis.price * (1 - basis.discountPercent! / 100)
    : basis.price;
  return { periodStart, periodEnd, amount: Math.round(amount * 100) / 100 };
}
