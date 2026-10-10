-- A empresa passa a ficar no próprio pagamento: os pagamentos de contratação de
-- plano não têm agendamento de onde herdá-la.

-- 1. Coluna sem obrigatoriedade, para aceitar os pagamentos existentes.
ALTER TABLE "payments" ADD COLUMN "companyId" TEXT;

-- 2. Preenche os existentes com a empresa do agendamento (todos têm agendamento até aqui).
UPDATE "payments" AS p
SET "companyId" = a."companyId"
FROM "appointments" AS a
WHERE a."id" = p."appointmentId"
  AND p."companyId" IS NULL;

-- 3. Só então a coluna se torna obrigatória.
ALTER TABLE "payments" ALTER COLUMN "companyId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "payments_companyId_idx" ON "payments"("companyId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
