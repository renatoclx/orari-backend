-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_categories_companyId_idx" ON "expense_categories"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_companyId_normalizedName_key" ON "expense_categories"("companyId", "normalizedName") WHERE ("deletedAt" IS NULL);

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Categorias iniciais para as empresas que já existem (as novas recebem as
-- mesmas na criação; ver DEFAULT_EXPENSE_CATEGORIES). O nome normalizado é
-- escrito à mão, igual ao normalizeForSearch.
INSERT INTO "expense_categories" ("id", "name", "normalizedName", "companyId")
SELECT gen_random_uuid()::text, c.name, c.normalized, co."id"
FROM "companies" co
CROSS JOIN (VALUES
  ('Aluguel', 'aluguel'),
  ('Energia', 'energia'),
  ('Água', 'agua'),
  ('Internet e telefone', 'internet e telefone'),
  ('Produtos', 'produtos'),
  ('Comissões', 'comissoes'),
  ('Salários', 'salarios'),
  ('Impostos', 'impostos'),
  ('Outros', 'outros')
) AS c(name, normalized);
