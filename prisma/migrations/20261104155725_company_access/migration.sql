-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'COMPANY_ACCESS_CHANGED';

-- CreateTable
CREATE TABLE "company_feature_access" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT false,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "canCreate" BOOLEAN NOT NULL DEFAULT false,
    "canRemove" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "company_feature_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_limits" (
    "companyId" TEXT NOT NULL,
    "maxProfessionals" INTEGER NOT NULL,
    "maxAdmins" INTEGER NOT NULL,

    CONSTRAINT "company_limits_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_feature_access_companyId_feature_key" ON "company_feature_access"("companyId", "feature");

-- AddForeignKey
ALTER TABLE "company_feature_access" ADD CONSTRAINT "company_feature_access_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_limits" ADD CONSTRAINT "company_limits_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Empresas já existentes continuam com acesso total e limites folgados: nada
-- muda para quem já usa o sistema; o SUPER_ADMIN ajusta depois.
INSERT INTO "company_feature_access" ("id", "companyId", "feature", "canView", "canEdit", "canCreate", "canRemove")
SELECT gen_random_uuid()::text, c."id", f."feature", true, f."canEdit", f."canCreate", f."canRemove"
FROM "companies" c
CROSS JOIN (VALUES
    ('appointments', true, true, true),
    ('recurrences', true, true, true),
    ('clients', true, true, true),
    ('employees', true, true, true),
    ('professionals', true, true, true),
    ('users', true, true, true),
    ('services', true, true, true),
    ('plans', true, true, true),
    ('contracts', true, true, true),
    ('tabs', true, true, true),
    ('payments', true, true, true),
    ('payment-methods', true, true, true),
    ('anamnesis', true, true, true),
    ('anamnesis-templates', true, true, true),
    ('anamnesis-audit', false, false, false),
    ('class-groups', true, true, true),
    ('settings', true, false, false)
) AS f("feature", "canEdit", "canCreate", "canRemove");

INSERT INTO "company_limits" ("companyId", "maxProfessionals", "maxAdmins")
SELECT "id", 999, 999 FROM "companies";
