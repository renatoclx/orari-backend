-- O nome do método de pagamento passa a ser único pelo nome normalizado (sem
-- acentos e em minúsculas): "PIX", "Pix" e "pix" são o mesmo método.
DROP INDEX "payment_methods_companyId_name_key";

CREATE UNIQUE INDEX "payment_methods_companyId_normalizedName_key" ON "payment_methods"("companyId", "normalizedName") WHERE ("deletedAt" IS NULL);
