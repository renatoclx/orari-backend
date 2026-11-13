-- Resumo de pendências do dia do administrador: a categoria de notificação, a
-- situação das mensagens automáticas e as opções dela (hora e itens).
ALTER TYPE "NotificationCategory" ADD VALUE 'PENDING_SUMMARY';
ALTER TYPE "AutoMessageKind" ADD VALUE 'ADMIN_SUMMARY';
ALTER TABLE "auto_messages" ADD COLUMN "summaryHour" INTEGER;
ALTER TABLE "auto_messages" ADD COLUMN "summaryItems" TEXT[] DEFAULT ARRAY[]::TEXT[];
