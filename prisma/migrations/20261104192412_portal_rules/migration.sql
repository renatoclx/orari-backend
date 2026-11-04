-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('CLINIC', 'PORTAL');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "source" "AppointmentSource" NOT NULL DEFAULT 'CLINIC';

-- CreateTable
CREATE TABLE "portal_settings" (
    "companyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "minAdvanceMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxDaysAhead" INTEGER NOT NULL DEFAULT 30,
    "cancelUntilHours" INTEGER NOT NULL DEFAULT 24,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "portal_settings_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "service_professionals" (
    "serviceId" TEXT NOT NULL,
    "peopleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_professionals_pkey" PRIMARY KEY ("serviceId","peopleId")
);

-- CreateIndex
CREATE INDEX "service_professionals_peopleId_idx" ON "service_professionals"("peopleId");

-- AddForeignKey
ALTER TABLE "portal_settings" ADD CONSTRAINT "portal_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_professionals" ADD CONSTRAINT "service_professionals_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_professionals" ADD CONSTRAINT "service_professionals_peopleId_fkey" FOREIGN KEY ("peopleId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- O portal do cliente vale para todos os planos: toda empresa existente recebe
-- a funcionalidade (visualizar e editar). Ligar o portal continua sendo uma
-- escolha da clínica (portal_settings.enabled nasce falso).
INSERT INTO "company_feature_access" ("id", "companyId", "feature", "canView", "canEdit", "canCreate", "canRemove")
SELECT gen_random_uuid()::text, c."id", 'client-portal', true, true, false, false
FROM "companies" c
ON CONFLICT ("companyId", "feature") DO NOTHING;
