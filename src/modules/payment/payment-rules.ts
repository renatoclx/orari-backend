import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PaymentStatus } from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";

/**
 * Regras e consultas do pagamento usadas tanto pelo PaymentService quanto pela
 * comanda (PaymentCheckoutService). Funções puras: não acessam o banco.
 */

// Itens da venda de produtos: o que foi vendido descreve o pagamento.
export const saleItemsSelect = {
  select: {
    quantity: true,
    unitPrice: true,
    product: { select: { id: true, name: true } },
  },
  orderBy: { id: "asc" },
} satisfies Prisma.ProductSale$itemsArgs;

/**
 * Atraso é derivado, não gravado: pendente com vencimento antes de hoje. O
 * status continua PENDING até a baixa (ver business-rules/pagamentos.md).
 */
export function isOverdue(
  { status, dueDate }: { status: PaymentStatus; dueDate: Date | null },
  today: Date,
): boolean {
  return (
    status === PaymentStatus.PENDING && dueDate !== null && dueDate < today
  );
}

// Soma dos valores dos pagamentos.
export function sumAmounts(payments: { amount: Decimal }[]): Decimal {
  return payments.reduce((acc, p) => acc.plus(p.amount), new Decimal(0));
}

// A baixa registra um pagamento que já aconteceu: data futura não faz sentido.
// Data passada é aceita, para lançar uma baixa esquecida.
export function ensurePaidAtIsNotFuture(paidAt?: Date): void {
  if (paidAt && paidAt.getTime() > Date.now()) {
    throw new BadRequestException("paidAt não pode estar no futuro");
  }
}

// O pagamento é único por agendamento: a violação vira 409.
export function mapUniqueViolation(error: unknown): unknown {
  return isUniqueConstraintViolation(error)
    ? new ConflictException("Este agendamento já possui um pagamento")
    : error;
}
