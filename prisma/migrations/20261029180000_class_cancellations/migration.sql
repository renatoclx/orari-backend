-- CreateEnum
CREATE TYPE "AppointmentCancelReason" AS ENUM ('CLASS_SESSION_CANCELLED', 'CLASS_LEFT');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "cancelReason" "AppointmentCancelReason";

-- AlterTable
ALTER TABLE "class_sessions" ADD COLUMN     "cancellationNote" TEXT;

-- AlterTable
ALTER TABLE "recurring_appointments" ADD COLUMN     "classLeaveNote" TEXT,
ADD COLUMN     "classLeftAt" TIMESTAMP(3);

