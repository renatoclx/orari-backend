-- O tipo USER deixa de existir: os papéis são SUPER_ADMIN, ADMIN e PROFESSIONAL.
-- Os usuários USER são apagados de vez. As chaves estrangeiras são RESTRICT, então
-- os registros que apontam para eles saem antes (sessões e auditoria); se outra
-- tabela ainda apontar para um deles, a migração falha sem apagar nada.
DELETE FROM "refresh_tokens" WHERE "userId" IN (SELECT "id" FROM "users" WHERE "type" = 'USER');
DELETE FROM "audit_logs" WHERE "userId" IN (SELECT "id" FROM "users" WHERE "type" = 'USER');
DELETE FROM "users" WHERE "type" = 'USER';

-- O Postgres não remove valor de enum: cria o tipo novo e troca a coluna.
ALTER TYPE "UserType" RENAME TO "UserType_old";
CREATE TYPE "UserType" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'PROFESSIONAL');
ALTER TABLE "users" ALTER COLUMN "type" TYPE "UserType" USING ("type"::text::"UserType");
DROP TYPE "UserType_old";

-- Um único SUPER_ADMIN ativo (o admin da plataforma): o índice sobre a constante
-- `true` admite no máximo uma linha, mesmo com duas requisições ao mesmo tempo.
CREATE UNIQUE INDEX "users_single_super_admin_key" ON "users"((true)) WHERE "type" = 'SUPER_ADMIN' AND "deletedAt" IS NULL;
