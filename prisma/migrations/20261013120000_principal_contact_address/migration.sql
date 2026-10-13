-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "isPrincipal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "isPrincipal" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "addresses_principal_company_key" ON "addresses"("companyId") WHERE ("isPrincipal" AND "deletedAt" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "addresses_principal_people_key" ON "addresses"("peopleId") WHERE ("isPrincipal" AND "deletedAt" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_principal_company_key" ON "contacts"("companyId") WHERE ("isPrincipal" AND "deletedAt" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_principal_people_key" ON "contacts"("peopleId") WHERE ("isPrincipal" AND "deletedAt" IS NULL);

