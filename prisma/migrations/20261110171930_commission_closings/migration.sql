-- AlterTable
ALTER TABLE "commission_advances" ADD COLUMN     "closingId" TEXT;

-- AlterTable
ALTER TABLE "commissions" ADD COLUMN     "closingId" TEXT;

-- CreateTable
CREATE TABLE "commission_closings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "professionalId" TEXT NOT NULL,
    "cutoffDate" DATE NOT NULL,
    "paidAt" DATE NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "commissionTotal" DECIMAL(10,2) NOT NULL,
    "advanceTotal" DECIMAL(10,2) NOT NULL,
    "paidAmount" DECIMAL(10,2) NOT NULL,
    "appointmentsCount" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,

    CONSTRAINT "commission_closings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_closings_companyId_professionalId_idx" ON "commission_closings"("companyId", "professionalId");

-- CreateIndex
CREATE UNIQUE INDEX "commission_closings_companyId_number_key" ON "commission_closings"("companyId", "number");

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "commission_closings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_advances" ADD CONSTRAINT "commission_advances_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "commission_closings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_closings" ADD CONSTRAINT "commission_closings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_closings" ADD CONSTRAINT "commission_closings_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_closings" ADD CONSTRAINT "commission_closings_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_closings" ADD CONSTRAINT "commission_closings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_closings" ADD CONSTRAINT "commission_closings_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
