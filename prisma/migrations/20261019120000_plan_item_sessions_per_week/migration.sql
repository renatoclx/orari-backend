-- AlterTable
ALTER TABLE "plan_items" ADD COLUMN     "sessionsPerWeek" INTEGER NOT NULL DEFAULT 1;

-- Frequência semanal entre 1 e 7 (o DTO valida igual; o banco garante).
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_sessionsPerWeek_check" CHECK ("sessionsPerWeek" BETWEEN 1 AND 7);
