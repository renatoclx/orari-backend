-- CreateEnum
CREATE TYPE "PlanBillingType" AS ENUM ('INTEGRAL', 'MONTHLY');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "clientPlanId" TEXT;

-- AlterTable
ALTER TABLE "recurring_appointments" ADD COLUMN     "clientPlanId" TEXT;

-- CreateTable
CREATE TABLE "client_plans" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "billingType" "PlanBillingType" NOT NULL,
    "months" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "monthlyAmount" DECIMAL(10,2) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "firstDueDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "client_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_plans_companyId_idx" ON "client_plans"("companyId");

-- CreateIndex
CREATE INDEX "client_plans_clientId_idx" ON "client_plans"("clientId");

-- CreateIndex
CREATE INDEX "client_plans_planId_idx" ON "client_plans"("planId");

-- CreateIndex
CREATE INDEX "payments_clientPlanId_idx" ON "payments"("clientPlanId");

-- CreateIndex
CREATE INDEX "recurring_appointments_clientPlanId_idx" ON "recurring_appointments"("clientPlanId");

-- AddForeignKey
ALTER TABLE "recurring_appointments" ADD CONSTRAINT "recurring_appointments_clientPlanId_fkey" FOREIGN KEY ("clientPlanId") REFERENCES "client_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_plans" ADD CONSTRAINT "client_plans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_plans" ADD CONSTRAINT "client_plans_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_plans" ADD CONSTRAINT "client_plans_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_clientPlanId_fkey" FOREIGN KEY ("clientPlanId") REFERENCES "client_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
