/*
  Warnings:

  - You are about to drop the column `recurringAppointmentId` on the `notifications` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `notifications` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_recurringAppointmentId_fkey";

-- DropIndex
DROP INDEX "notifications_recurringAppointmentId_idx";

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "recurringAppointmentId",
DROP COLUMN "type";

-- DropEnum
DROP TYPE "NotificationType";
