-- Avisos de agendamento ao profissional: categorias de notificação (lembrete e
-- resumo da manhã) e as duas situações novas das mensagens automáticas.
ALTER TYPE "NotificationCategory" ADD VALUE 'REMINDER';
ALTER TYPE "NotificationCategory" ADD VALUE 'DAILY_SUMMARY';
ALTER TYPE "AutoMessageKind" ADD VALUE 'PROFESSIONAL_REMINDER';
ALTER TYPE "AutoMessageKind" ADD VALUE 'PROFESSIONAL_SUMMARY';
