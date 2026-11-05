-- Conta do cliente no app (ver docs/business-rules.md, "Portal do cliente").
-- As sessões do portal passam a ser da conta, não de uma clínica. O portal
-- ainda não foi para produção: as sessões antigas (só de teste) são apagadas.
DELETE FROM "portal_sessions";

-- DropForeignKey
ALTER TABLE "portal_sessions" DROP CONSTRAINT "portal_sessions_companyId_fkey";

-- DropForeignKey
ALTER TABLE "portal_sessions" DROP CONSTRAINT "portal_sessions_peopleId_fkey";

-- DropIndex
DROP INDEX "portal_sessions_peopleId_idx";

-- AlterTable
ALTER TABLE "people" ADD COLUMN     "clientAccountId" TEXT;

-- AlterTable
ALTER TABLE "portal_sessions" DROP COLUMN "companyId",
DROP COLUMN "peopleId",
ADD COLUMN     "clientAccountId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "client_accounts" (
    "id" TEXT NOT NULL,
    "phone" VARCHAR(11) NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "client_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_accounts_phone_key" ON "client_accounts"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "people_companyId_clientAccountId_key" ON "people"("companyId", "clientAccountId") WHERE ("deletedAt" IS NULL AND "clientAccountId" IS NOT NULL);

-- CreateIndex
CREATE INDEX "portal_sessions_clientAccountId_idx" ON "portal_sessions"("clientAccountId");

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "client_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "client_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

