-- Assinatura da empresa (plano, ciclo, valor guardado e datas que definem a situação).
-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('ESSENTIAL', 'PLUS', 'CLINICAL');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'SEMIANNUAL', 'ANNUAL');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_CHANGED';

-- CreateTable
CREATE TABLE "company_subscriptions" (
    "companyId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "cycle" "BillingCycle" NOT NULL,
    "extraProfessionals" INTEGER NOT NULL DEFAULT 0,
    "anamnesisAddon" BOOLEAN NOT NULL DEFAULT false,
    "price" DECIMAL(10,2) NOT NULL,
    "discountPercent" INTEGER,
    "discountUntil" DATE,
    "trialEndsAt" DATE,
    "paidUntil" DATE,
    "canceledAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "company_subscriptions_pkey" PRIMARY KEY ("companyId")
);

-- AddForeignKey
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
