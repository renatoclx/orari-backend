-- Limpar a caixa de notificações: a linha fica (a chave de deduplicação continua
-- valendo) e só some da lista e do contador.
ALTER TABLE "user_notifications" ADD COLUMN "clearedAt" TIMESTAMP(3);
