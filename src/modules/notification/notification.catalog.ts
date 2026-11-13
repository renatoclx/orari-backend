import type { NotificationCategory } from "../../../generated/prisma/enums";

/**
 * Categorias de notificação e o padrão do push de cada uma. A caixa recebe
 * tudo; só o push tem interruptor. Uma fonte nova de aviso acrescenta a sua
 * categoria aqui, no enum do Prisma e na tela de preferências.
 */
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  "APPOINTMENT",
];

export const DEFAULT_PUSH = true;
