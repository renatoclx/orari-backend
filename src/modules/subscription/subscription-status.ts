/**
 * Situação da assinatura, calculada pelas datas (ver
 * docs/business-rules/empresa-e-acesso.md, "Assinatura"). Função pura: o "hoje"
 * vem de fora, já no fuso da empresa (coluna `date`, UTC 00:00).
 */
export type SubscriptionStatus =
  "TRIAL" | "ACTIVE" | "OVERDUE" | "READ_ONLY" | "CANCELED";

/** Dias depois do vencimento em que a empresa ainda altera os dados, com aviso. */
export const GRACE_DAYS = 5;

export interface SubscriptionDates {
  trialEndsAt: Date | null;
  paidUntil: Date | null;
  canceledAt: Date | null;
}

export interface SubscriptionState {
  status: SubscriptionStatus;
  /** Somente leitura: a API recusa as gravações da empresa. */
  readOnly: boolean;
  /**
   * Último dia da situação atual: fim do teste, vencimento (ativa) ou último
   * dia da tolerância (em atraso). Nulo em somente leitura e cancelada.
   */
  endsAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function subscriptionState(
  { trialEndsAt, paidUntil, canceledAt }: SubscriptionDates,
  today: Date,
): SubscriptionState {
  // Cancelada vale a partir da data, mesmo com período pago.
  if (canceledAt && today >= canceledAt) {
    return { status: "CANCELED", readOnly: true, endsAt: null };
  }
  if (paidUntil && today <= paidUntil) {
    return { status: "ACTIVE", readOnly: false, endsAt: paidUntil };
  }
  if (trialEndsAt && today <= trialEndsAt) {
    return { status: "TRIAL", readOnly: false, endsAt: trialEndsAt };
  }
  if (paidUntil) {
    const lastGraceDay = addDays(paidUntil, GRACE_DAYS);
    if (today <= lastGraceDay) {
      return { status: "OVERDUE", readOnly: false, endsAt: lastGraceDay };
    }
  }
  // Teste acabou sem pagamento, ou passou a tolerância do vencimento.
  return { status: "READ_ONLY", readOnly: true, endsAt: null };
}
