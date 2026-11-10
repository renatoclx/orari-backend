-- AlterTable
ALTER TABLE "people" ADD COLUMN     "commissionSince" TIMESTAMP(3),
ADD COLUMN     "receivesCommission" BOOLEAN NOT NULL DEFAULT true;

-- O profissional vinculado a um usuário ADMIN ativo (o dono que atende) não
-- recebe comissão (decisão de 2026-11-10).
UPDATE "people" SET "receivesCommission" = false
WHERE "type" = 'PROFESSIONAL' AND "id" IN (
  SELECT "peopleId" FROM "users"
  WHERE "type" = 'ADMIN' AND "deletedAt" IS NULL AND "peopleId" IS NOT NULL
);
