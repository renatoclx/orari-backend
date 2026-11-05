-- "Meus dados" do app do cliente (ver docs/business-rules.md, "Portal do cliente").
-- AlterTable
ALTER TABLE "client_accounts" ADD COLUMN     "addressCep" CHAR(8),
ADD COLUMN     "addressCityId" TEXT,
ADD COLUMN     "addressComplement" TEXT,
ADD COLUMN     "addressNeighborhood" TEXT,
ADD COLUMN     "addressNumber" TEXT,
ADD COLUMN     "addressStreet" TEXT,
ADD COLUMN     "birthDate" DATE,
ADD COLUMN     "document" CHAR(11),
ADD COLUMN     "email" TEXT,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "profession" TEXT;

-- AddForeignKey
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_addressCityId_fkey" FOREIGN KEY ("addressCityId") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

