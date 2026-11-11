-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('INITIAL', 'PURCHASE', 'INTERNAL_USE', 'LOSS', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "unitCost" DECIMAL(10,2),
    "note" TEXT,
    "createdById" TEXT,
    "payableId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_payableId_key" ON "stock_movements"("payableId");

-- CreateIndex
CREATE INDEX "stock_movements_productId_createdAt_idx" ON "stock_movements"("productId", "createdAt");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Saldo de antes do controle de estoque: cada produto (não excluído) ganha a
-- movimentação inicial com o estoque que já tinha, para o histórico fechar.
INSERT INTO "stock_movements" ("id", "companyId", "productId", "type", "quantity", "balanceAfter", "createdAt")
SELECT gen_random_uuid()::text, "companyId", "id", 'INITIAL', "currentStock", "currentStock", "createdAt"
FROM "products"
WHERE "deletedAt" IS NULL;
