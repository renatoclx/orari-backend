-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "recurringAppointmentId" TEXT;

-- CreateTable
CREATE TABLE "business_hours" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "weekDay" "WeekDay" NOT NULL,
    "openAt" TIME(0) NOT NULL,
    "closeAt" TIME(0) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_hours_companyId_weekDay_idx" ON "business_hours"("companyId", "weekDay");

-- CreateIndex
CREATE INDEX "appointments_recurringAppointmentId_idx" ON "appointments"("recurringAppointmentId");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_recurringAppointmentId_fkey" FOREIGN KEY ("recurringAppointmentId") REFERENCES "recurring_appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

