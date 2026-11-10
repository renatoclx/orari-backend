import { CommissionType, PaymentStatus } from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";

// Duas casas decimais, com a metade arredondada para cima (como nos pacotes).
const roundMoney = (value: Decimal) =>
  value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** O que a conta da base lê de um atendimento concluído. */
export interface CommissionSource {
  /** Pagamento próprio (avulso, recorrência, turma avulsa). */
  payment: {
    amount: Decimal;
    status: PaymentStatus;
    deletedAt: Date | null;
  } | null;
  /** Contratação, quando o atendimento é sessão de pacote. */
  clientPlanId: string | null;
}

/**
 * Valor de uma sessão do pacote (opção A, decidida em 2026-11-10): o total
 * contratado ÷ as sessões geradas na contratação. Os agendamentos nunca são
 * apagados (o cancelado continua), então a conta é estável.
 */
export function packageSessionValue(totalAmount: Decimal, sessions: number) {
  return sessions > 0
    ? roundMoney(totalAmount.dividedBy(sessions))
    : new Decimal(0);
}

/**
 * Base da comissão: a sessão do pacote; senão, o pagamento do atendimento
 * (ativo e não cancelado); sem ele, o preço do serviço (o avulso que ainda vai
 * ser cobrado na comanda).
 */
export function commissionBase(
  source: CommissionSource,
  servicePrice: Decimal | null,
  sessionValue: Decimal | null,
): Decimal {
  if (source.clientPlanId) return sessionValue ?? new Decimal(0);
  const { payment } = source;
  if (
    payment &&
    payment.deletedAt === null &&
    payment.status !== PaymentStatus.CANCELLED
  ) {
    return payment.amount;
  }
  return servicePrice ?? new Decimal(0);
}

/** Percentual da base ou o valor fixo da regra. */
export function commissionAmount(
  type: CommissionType,
  rate: Decimal,
  base: Decimal,
): Decimal {
  return type === CommissionType.FIXED
    ? rate
    : roundMoney(base.times(rate).dividedBy(100));
}
