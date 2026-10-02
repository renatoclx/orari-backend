-- Renomeia publicPlace para street e adiciona neighborhood (opcional) em addresses
ALTER TABLE "addresses" RENAME COLUMN "publicPlace" TO "street";
ALTER TABLE "addresses" ADD COLUMN "neighborhood" TEXT;

-- Adiciona note (opcional) em people
ALTER TABLE "people" ADD COLUMN "note" TEXT;
