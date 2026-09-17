-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('USER', 'ADMIN');

-- AlterEnum
BEGIN;
CREATE TYPE "PeopleType_new" AS ENUM ('CLIENT', 'EMPLOYEE', 'PROFESSIONAL');
ALTER TABLE "people" ALTER COLUMN "type" TYPE "PeopleType_new" USING ("type"::text::"PeopleType_new");
ALTER TYPE "PeopleType" RENAME TO "PeopleType_old";
ALTER TYPE "PeopleType_new" RENAME TO "PeopleType";
DROP TYPE "public"."PeopleType_old";
COMMIT;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "foundationDate" SET NOT NULL;

-- AlterTable
ALTER TABLE "contacts" ALTER COLUMN "phone" DROP NOT NULL,
ALTER COLUMN "email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "people" ALTER COLUMN "birthDate" SET NOT NULL;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "isActive",
ADD COLUMN     "companyId" TEXT NOT NULL,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "type" "UserType" NOT NULL;

-- CreateIndex
CREATE INDEX "users_companyId_idx" ON "users"("companyId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddCheckConstraint
-- Um contato precisa ter ao menos um meio de contato: telefone e/ou e-mail.
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_phone_or_email_check" CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL);
