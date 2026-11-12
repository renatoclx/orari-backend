-- Login do usuário PROFESSIONAL no app: pelo telefone, como o cliente.
ALTER TABLE "users" ADD COLUMN "phone" VARCHAR(11);

-- Único entre os ativos: dois profissionais com o mesmo telefone tornariam o login ambíguo.
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone") WHERE "deletedAt" IS NULL AND "phone" IS NOT NULL;
