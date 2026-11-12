-- Auditoria da alteração e da exclusão de pagamento pago (só o ADMIN as faz).
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_PAID_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_PAID_REMOVED';

-- Antes e depois da ação, quando ela altera valores.
ALTER TABLE "audit_logs" ADD COLUMN "details" JSONB;
