-- A empresa passa a aceitar CPF ou CNPJ: a coluna cnpj vira document.
ALTER TABLE "companies" RENAME COLUMN "cnpj" TO "document";

-- VARCHAR em vez de CHAR: o CHAR(14) completaria um CPF (11) com espaços.
ALTER TABLE "companies" ALTER COLUMN "document" TYPE VARCHAR(14);

-- O índice único acompanha o novo nome da coluna (é o nome que o Prisma espera).
ALTER INDEX "companies_cnpj_key" RENAME TO "companies_document_key";

-- A data de fundação não se aplica a quem usa CPF.
ALTER TABLE "companies" ALTER COLUMN "foundationDate" DROP NOT NULL;
