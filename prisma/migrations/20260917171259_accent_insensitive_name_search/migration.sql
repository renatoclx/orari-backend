-- Busca por nome sem diferenciar acentos e maiúsculas, com índice trigram.
-- A coluna "normalizedName" é mantida pela aplicação (normalizeForSearch); esta
-- migration apenas prepara a estrutura e preenche os registros já existentes.

-- CreateExtension
-- pg_trgm: operadores e índices trigram usados pela busca parcial (LIKE '%termo%').
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent: usado somente no preenchimento abaixo; a aplicação não depende dele.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- AlterTable
-- A coluna nasce anulável para permitir o preenchimento das linhas existentes
-- (ex.: cidades do seed) e só depois passa a ser obrigatória.
ALTER TABLE "cities" ADD COLUMN "normalizedName" TEXT;
UPDATE "cities" SET "normalizedName" = lower(unaccent("name"));
ALTER TABLE "cities" ALTER COLUMN "normalizedName" SET NOT NULL;

-- AlterTable
ALTER TABLE "people" ADD COLUMN "normalizedName" TEXT;
UPDATE "people" SET "normalizedName" = lower(unaccent("name"));
ALTER TABLE "people" ALTER COLUMN "normalizedName" SET NOT NULL;

-- DropExtension
DROP EXTENSION unaccent;

-- CreateIndex
CREATE INDEX "cities_normalizedName_idx" ON "cities" USING GIN ("normalizedName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "people_normalizedName_idx" ON "people" USING GIN ("normalizedName" gin_trgm_ops);
