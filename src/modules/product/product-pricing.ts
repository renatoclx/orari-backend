import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";

/**
 * Margem de lucro sobre o preço de venda, em percentual com duas casas:
 * (venda − custo) ÷ venda × 100. Venda 100 e custo 60 dão 40. Fica negativa
 * quando o custo passa da venda. O Decimal evita o erro de arredondamento do
 * ponto flutuante (0,1 + 0,2).
 */
export function profitMarginOf(
  salePrice: Decimal | number,
  purchasePrice: Decimal | number,
): Decimal {
  const sale = new Decimal(salePrice);

  return sale
    .minus(purchasePrice)
    .div(sale)
    .times(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
