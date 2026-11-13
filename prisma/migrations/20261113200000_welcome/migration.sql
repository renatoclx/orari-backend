-- Boas-vindas do primeiro acesso: a categoria de notificação e as marcas do
-- usuário. Quem já existe não recebe as boas-vindas (só quem entra pela primeira
-- vez depois desta mudança).
ALTER TYPE "NotificationCategory" ADD VALUE 'WELCOME';
ALTER TABLE "users" ADD COLUMN "welcomedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "onboardingDismissedAt" TIMESTAMP(3);
UPDATE "users" SET "welcomedAt" = now();
