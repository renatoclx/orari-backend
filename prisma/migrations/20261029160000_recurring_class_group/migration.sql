-- AlterTable
ALTER TABLE "recurring_appointments" ADD COLUMN     "classGroupId" TEXT;

-- CreateIndex
CREATE INDEX "recurring_appointments_classGroupId_idx" ON "recurring_appointments"("classGroupId");

-- AddForeignKey
ALTER TABLE "recurring_appointments" ADD CONSTRAINT "recurring_appointments_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "class_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

