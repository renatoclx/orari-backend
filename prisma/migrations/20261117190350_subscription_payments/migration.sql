-- Pagamentos da assinatura (cobrança manual do SUPER_ADMIN).
-- CreateEnum
CREATE TYPE "SubscriptionPaymentMethod" AS ENUM ('PIX', 'CARD', 'BOLETO', 'TRANSFER', 'CASH', 'OTHER');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_PAYMENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_PAYMENT_REMOVED';

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paidAt" DATE NOT NULL,
    "method" "SubscriptionPaymentMethod" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "previousPaidUntil" DATE,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscription_payments_companyId_createdAt_idx" ON "subscription_payments"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "subscription_payments_paidAt_idx" ON "subscription_payments"("paidAt");

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
