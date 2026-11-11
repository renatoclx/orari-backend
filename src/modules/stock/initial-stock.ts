import { StockMovementType } from "../../../generated/prisma/enums";
import type { Prisma } from "../../../generated/prisma/client";

/**
 * Saldo informado no cadastro do produto: vira a primeira movimentação, para o
 * histórico fechar com o estoque atual. Roda na transação do cadastro.
 */
export async function recordInitialStock(
  tx: Prisma.TransactionClient,
  data: {
    companyId: string;
    productId: string;
    quantity: number;
    createdById: string;
  },
): Promise<void> {
  await tx.stockMovement.create({
    data: {
      ...data,
      type: StockMovementType.INITIAL,
      balanceAfter: data.quantity,
    },
  });
}
