-- Cliente que entra sozinho pelo app num estabelecimento (ver docs/business-rules.md,
-- "Portal do cliente"): fica não confirmado até a clínica confirmar.
-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PORTAL_CLIENT_CONFIRMED';

-- AlterTable
ALTER TABLE "people" ADD COLUMN     "portalConfirmed" BOOLEAN NOT NULL DEFAULT true;

