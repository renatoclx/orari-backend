import { SetMetadata } from "@nestjs/common";

export const ALLOW_READ_ONLY_KEY = "allowReadOnly";

/**
 * Rota que grava, mas continua liberada com a assinatura em somente leitura:
 * o que é do próprio usuário (senha, notificações), não dado da empresa.
 */
export const AllowReadOnly = () => SetMetadata(ALLOW_READ_ONLY_KEY, true);
