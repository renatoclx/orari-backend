-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "dueDate" DATE,
ALTER COLUMN "appointmentId" DROP NOT NULL;
