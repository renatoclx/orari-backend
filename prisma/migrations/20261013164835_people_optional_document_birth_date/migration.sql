-- O cliente poderá ser cadastrado só com nome e telefone (contato).
-- AlterTable
ALTER TABLE "people" ALTER COLUMN "document" DROP NOT NULL,
ALTER COLUMN "birthDate" DROP NOT NULL;
