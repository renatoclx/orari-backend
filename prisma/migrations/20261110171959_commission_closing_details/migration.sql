/*
  Warnings:

  - Added the required column `details` to the `commission_closings` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "commission_closings" ADD COLUMN     "details" JSONB NOT NULL;
