-- AlterTable
ALTER TABLE "people" ADD COLUMN     "expenseCategoryId" TEXT,
ALTER COLUMN "document" SET DATA TYPE VARCHAR(14);

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
