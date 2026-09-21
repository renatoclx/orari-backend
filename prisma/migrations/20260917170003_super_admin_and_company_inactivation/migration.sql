-- AlterEnum
ALTER TYPE "UserType" ADD VALUE 'SUPER_ADMIN';

-- DropIndex
DROP INDEX "companies_cnpj_key";

-- DropIndex
DROP INDEX "companies_subdomain_key";

-- AlterTable
ALTER TABLE "companies" DROP COLUMN "deletedAt";

-- AlterTable
ALTER TABLE "people" ALTER COLUMN "document" SET DATA TYPE CHAR(11);

-- CreateIndex
CREATE UNIQUE INDEX "companies_cnpj_key" ON "companies"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "companies_subdomain_key" ON "companies"("subdomain");

