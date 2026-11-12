-- Perfil só de app: o profissional entra pelo PWA e vê o que é dele.
ALTER TYPE "UserType" ADD VALUE 'PROFESSIONAL';

-- App do profissional vem em todos os planos: liga a funcionalidade (só
-- Visualiza) nas empresas que já existem. Empresa nova nasce com ela pelo
-- modelo padrão (defaultFeatureAccessRows); o SUPER_ADMIN pode desligar.
INSERT INTO "company_feature_access" ("id", "companyId", "feature", "canView", "canEdit", "canCreate", "canRemove")
SELECT gen_random_uuid()::text, "id", 'professional-app', true, false, false, false
FROM "companies"
ON CONFLICT ("companyId", "feature") DO NOTHING;
