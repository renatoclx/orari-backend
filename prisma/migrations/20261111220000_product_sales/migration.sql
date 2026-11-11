-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'SALE';
ALTER TYPE "StockMovementType" ADD VALUE 'SALE_CANCELLED';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "productSaleId" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "productSaleId" TEXT;

-- CreateTable
CREATE TABLE "product_sales" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,

    CONSTRAINT "product_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_sale_items" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "product_sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_sales_companyId_createdAt_idx" ON "product_sales"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "product_sales_clientId_idx" ON "product_sales"("clientId");

-- CreateIndex
CREATE INDEX "product_sale_items_saleId_idx" ON "product_sale_items"("saleId");

-- CreateIndex
CREATE INDEX "product_sale_items_productId_idx" ON "product_sale_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_productSaleId_key" ON "payments"("productSaleId");

-- CreateIndex
CREATE INDEX "stock_movements_productSaleId_idx" ON "stock_movements"("productSaleId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_productSaleId_fkey" FOREIGN KEY ("productSaleId") REFERENCES "product_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productSaleId_fkey" FOREIGN KEY ("productSaleId") REFERENCES "product_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_sales" ADD CONSTRAINT "product_sales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_sales" ADD CONSTRAINT "product_sales_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_sales" ADD CONSTRAINT "product_sales_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_sales" ADD CONSTRAINT "product_sales_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_sale_items" ADD CONSTRAINT "product_sale_items_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "product_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_sale_items" ADD CONSTRAINT "product_sale_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

