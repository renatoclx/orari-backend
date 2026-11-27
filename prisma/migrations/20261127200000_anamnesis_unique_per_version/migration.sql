-- Uma ficha por cliente e por versão do modelo (antes: por modelo). Atualizar
-- a ficha para a versão nova cria outra ficha do mesmo modelo.
-- DropIndex
DROP INDEX "anamneses_clientId_templateId_key";

-- CreateIndex
CREATE UNIQUE INDEX "anamneses_clientId_versionId_key" ON "anamneses"("clientId", "versionId");
