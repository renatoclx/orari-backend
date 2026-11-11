-- AlterTable
ALTER TABLE "commission_advances" ADD COLUMN     "paymentMethodId" TEXT;

-- AlterTable
ALTER TABLE "payables" ADD COLUMN     "commissionAdvanceId" TEXT,
ADD COLUMN     "commissionClosingId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payables_commissionClosingId_key" ON "payables"("commissionClosingId");

-- CreateIndex
CREATE UNIQUE INDEX "payables_commissionAdvanceId_key" ON "payables"("commissionAdvanceId");

-- AddForeignKey
ALTER TABLE "commission_advances" ADD CONSTRAINT "commission_advances_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_commissionClosingId_fkey" FOREIGN KEY ("commissionClosingId") REFERENCES "commission_closings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_commissionAdvanceId_fkey" FOREIGN KEY ("commissionAdvanceId") REFERENCES "commission_advances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

