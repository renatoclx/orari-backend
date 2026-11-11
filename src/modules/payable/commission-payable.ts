import { PayableStatus } from "../../../generated/prisma/enums";
import type { Prisma } from "../../../generated/prisma/client";
import type { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { normalizeForSearch } from "../../common/text/normalize-for-search";

// A categoria das contas geradas pela comissão (semeada em toda empresa).
const COMMISSION_CATEGORY = "Comissões";

/**
 * A categoria "Comissões" ativa da empresa. Se foi renomeada ou inativada,
 * é criada de novo: a conta da comissão sempre tem para onde ir.
 */
async function commissionCategoryId(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<string> {
  const normalizedName = normalizeForSearch(COMMISSION_CATEGORY);
  const found = await tx.expenseCategory.findFirst({
    where: { companyId, normalizedName, deletedAt: null },
    select: { id: true },
  });
  if (found) return found.id;
  const created = await tx.expenseCategory.create({
    data: { companyId, name: COMMISSION_CATEGORY, normalizedName },
    select: { id: true },
  });
  return created.id;
}

/**
 * Lança no Contas a pagar a saída de dinheiro da comissão (fechamento ou
 * adiantamento) como conta já paga, com o profissional como favorecido.
 * Roda dentro da transação de quem a gerou: ou as duas existem, ou nenhuma.
 */
export async function createCommissionPayable(
  tx: Prisma.TransactionClient,
  data: {
    companyId: string;
    professionalId: string;
    description: string;
    amount: Decimal | number;
    paidAt: Date;
    paymentMethodId: string;
    createdById: string;
    commissionClosingId?: string;
    commissionAdvanceId?: string;
  },
): Promise<void> {
  const { professionalId, paidAt, ...rest } = data;
  await tx.payable.create({
    data: {
      ...rest,
      payeeId: professionalId,
      categoryId: await commissionCategoryId(tx, data.companyId),
      dueDate: paidAt,
      paidAt,
      status: PayableStatus.PAID,
    },
  });
}
