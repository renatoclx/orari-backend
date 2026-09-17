-- DropIndex
DROP INDEX "companies_cnpj_key";

-- DropIndex
DROP INDEX "companies_subdomain_key";

-- DropIndex
DROP INDEX "people_companyId_document_key";

-- DropIndex
DROP INDEX "users_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "companies_cnpj_key" ON "companies"("cnpj") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "companies_subdomain_key" ON "companies"("subdomain") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "people_companyId_document_key" ON "people"("companyId", "document") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email") WHERE ("deletedAt" IS NULL);

