-- CreateEnum
CREATE TYPE "AnamnesisEntryKind" AS ENUM ('INITIAL', 'FOLLOW_UP');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ANAMNESIS_VIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'ANAMNESIS_LISTED';
ALTER TYPE "AuditAction" ADD VALUE 'ANAMNESIS_ENTRY_CREATED';

-- CreateTable
CREATE TABLE "anamneses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anamneses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anamnesis_entries" (
    "id" TEXT NOT NULL,
    "anamnesisId" TEXT NOT NULL,
    "kind" "AnamnesisEntryKind" NOT NULL,
    "consultationDate" DATE NOT NULL,
    "appointmentId" TEXT,
    "evolution" TEXT,
    "authorUserId" TEXT NOT NULL,
    "authorProfessionalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anamnesis_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anamnesis_answers" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "anamnesis_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "anamneses_companyId_idx" ON "anamneses"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "anamneses_clientId_templateId_key" ON "anamneses"("clientId", "templateId");

-- CreateIndex
CREATE INDEX "anamnesis_entries_anamnesisId_consultationDate_idx" ON "anamnesis_entries"("anamnesisId", "consultationDate");

-- CreateIndex
CREATE UNIQUE INDEX "anamnesis_answers_entryId_questionId_key" ON "anamnesis_answers"("entryId", "questionId");

-- AddForeignKey
ALTER TABLE "anamneses" ADD CONSTRAINT "anamneses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamneses" ADD CONSTRAINT "anamneses_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamneses" ADD CONSTRAINT "anamneses_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "anamnesis_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamneses" ADD CONSTRAINT "anamneses_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "anamnesis_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamnesis_entries" ADD CONSTRAINT "anamnesis_entries_anamnesisId_fkey" FOREIGN KEY ("anamnesisId") REFERENCES "anamneses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamnesis_entries" ADD CONSTRAINT "anamnesis_entries_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamnesis_entries" ADD CONSTRAINT "anamnesis_entries_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamnesis_entries" ADD CONSTRAINT "anamnesis_entries_authorProfessionalId_fkey" FOREIGN KEY ("authorProfessionalId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamnesis_answers" ADD CONSTRAINT "anamnesis_answers_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "anamnesis_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamnesis_answers" ADD CONSTRAINT "anamnesis_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "anamnesis_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

