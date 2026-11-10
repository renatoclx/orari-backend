-- AlterTable
ALTER TABLE "services" ADD COLUMN     "commissionSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "commissions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "baseAmount" DECIMAL(10,2) NOT NULL,
    "type" "CommissionType" NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commissions_appointmentId_key" ON "commissions"("appointmentId");

-- CreateIndex
CREATE INDEX "commissions_companyId_professionalId_idx" ON "commissions"("companyId", "professionalId");

-- CreateIndex
CREATE INDEX "commissions_serviceId_idx" ON "commissions"("serviceId");

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Serviço que já tinha comissão (etapa 1) passa a valer a partir de agora:
-- nada de comissão retroativa.
UPDATE "services" SET "commissionSince" = NOW()
WHERE "commissionType" IS NOT NULL AND "commissionSince" IS NULL;
