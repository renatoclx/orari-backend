-- Busca de estabelecimentos no app (ver docs/business-rules.md, "Portal do cliente").
-- CreateEnum
CREATE TYPE "BusinessSegment" AS ENUM ('BARBERSHOP', 'BEAUTY_SALON', 'AESTHETICS', 'NAIL_SALON', 'EYEBROW_DESIGN', 'PHYSIOTHERAPY', 'PILATES', 'PSYCHOLOGY', 'NUTRITION', 'DENTISTRY', 'OTHER');

-- AlterTable
ALTER TABLE "portal_settings" ADD COLUMN     "listed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "segment" "BusinessSegment";

