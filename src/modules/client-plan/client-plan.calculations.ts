import { PlanBillingType } from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";

/**
 * Contas da contratação de plano, sem banco e sem efeitos colaterais: recebem os
 * valores e devolvem o resultado. Ficam isoladas para serem testadas à parte,
 * porque lidam com dinheiro e com o calendário.
 *
 * Valores usam Decimal (o mesmo tipo das colunas do Prisma), nunca `number`:
 * em ponto flutuante, 0,1 + 0,2 não dá 0,3.
 *
 * Datas são "puras" (colunas `date`): só o dia importa, por isso todas as contas
 * de calendário usam UTC, sem fuso.
 */

// Aceita o Decimal vindo do banco ou um número/texto, como o próprio Decimal.
type DecimalInput = Decimal | number | string;

export interface PlanPricingInput {
  billingType: PlanBillingType;
  months: number;
  monthlyPrice: DecimalInput;
  // Os dois percentuais do período escolhido; a modalidade decide qual vale.
  discountPercent: DecimalInput;
  monthlyDiscountPercent: DecimalInput;
}

export interface PlanPricing {
  // Percentual efetivamente aplicado, conforme a modalidade.
  discountPercent: Decimal;
  totalAmount: Decimal;
  // Valor de cada pagamento a gerar: um no integral, um por mês no mensal.
  paymentAmounts: Decimal[];
}

/**
 * Integral: um pagamento com o total do período (mensal × meses) já com desconto.
 * Mensal: uma parcela por mês com o desconto mensal. A parcela é arredondada
 * antes de multiplicar, para que a soma das parcelas feche com o total.
 */
export function calculatePlanPricing({
  billingType,
  months,
  monthlyPrice,
  discountPercent,
  monthlyDiscountPercent,
}: PlanPricingInput): PlanPricing {
  const monthly = new Decimal(monthlyPrice);

  if (billingType === PlanBillingType.INTEGRAL) {
    const percent = new Decimal(discountPercent);
    const totalAmount = roundMoney(
      applyDiscount(monthly.times(months), percent),
    );

    return {
      discountPercent: percent,
      totalAmount,
      paymentAmounts: [totalAmount],
    };
  }

  const percent = new Decimal(monthlyDiscountPercent);
  const installment = roundMoney(applyDiscount(monthly, percent));

  return {
    discountPercent: percent,
    totalAmount: installment.times(months),
    paymentAmounts: Array.from({ length: months }, () => installment),
  };
}

/**
 * Último dia da contratação. Normalmente é a véspera do mesmo dia N meses depois
 * (15/10 + 3 meses termina em 14/01). Quando esse dia não existe no mês final
 * (início em 29, 30 ou 31), o período vai até o último dia daquele mês, para o
 * cliente não perder dias (31/01 + 1 mês termina em 28/02).
 */
export function calculateEndDate(startDate: Date, months: number): Date {
  const year = startDate.getUTCFullYear();
  const month = startDate.getUTCMonth() + months;
  const day = startDate.getUTCDate();

  if (day > daysInMonth(year, month)) {
    return utcDate(year, month, daysInMonth(year, month));
  }

  return utcDate(year, month, day - 1);
}

/**
 * Vencimentos mês a mês a partir do primeiro. O dia original é preservado: se
 * não existir no mês, vale o último dia daquele mês, sem "puxar" os seguintes
 * (31/01 → 28/02 → 31/03).
 */
export function calculateDueDates(firstDueDate: Date, count: number): Date[] {
  const year = firstDueDate.getUTCFullYear();
  const firstMonth = firstDueDate.getUTCMonth();
  const day = firstDueDate.getUTCDate();

  return Array.from({ length: count }, (_, index) => {
    const month = firstMonth + index;
    return utcDate(year, month, Math.min(day, daysInMonth(year, month)));
  });
}

// Percentual de 0 a 100 aplicado como desconto (10 → paga 90%).
function applyDiscount(value: Decimal, percent: Decimal): Decimal {
  return value.times(new Decimal(100).minus(percent)).dividedBy(100);
}

// Duas casas decimais, com a metade arredondada para cima (308,335 → 308,34).
function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

// `Date.UTC` aceita mês acima de 11 e ajusta o ano; o dia 0 é o último do mês anterior.
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}
