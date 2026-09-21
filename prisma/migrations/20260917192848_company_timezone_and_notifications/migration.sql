-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('RECURRING_APPOINTMENT_HORIZON');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "recurringAppointmentId" TEXT,
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_companyId_resolvedAt_idx" ON "notifications"("companyId", "resolvedAt");

-- CreateIndex
CREATE INDEX "notifications_recurringAppointmentId_idx" ON "notifications"("recurringAppointmentId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recurringAppointmentId_fkey" FOREIGN KEY ("recurringAppointmentId") REFERENCES "recurring_appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

