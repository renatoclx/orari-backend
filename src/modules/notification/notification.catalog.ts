import type {
  NotificationCategory,
  UserType,
} from "../../../generated/prisma/enums";

/**
 * Categorias de notificação e o padrão do push de cada uma. A caixa recebe
 * tudo; só o push tem interruptor. A boas-vindas (`WELCOME`) sai uma vez só e
 * não tem interruptor: fica fora desta lista e, portanto, das preferências. Uma fonte nova de aviso acrescenta a sua
 * categoria aqui, no enum do Prisma e na tela de preferências.
 */
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  "APPOINTMENT",
  "REMINDER",
  "DAILY_SUMMARY",
  "PENDING_SUMMARY",
];

export const DEFAULT_PUSH = true;

// O lembrete e o resumo da manhã são avisos do profissional; os agendamentos
// (o que o cliente e a clínica fazem) chegam a quem administra e a quem atende.
const PROFESSIONAL_ONLY: readonly NotificationCategory[] = [
  "REMINDER",
  "DAILY_SUMMARY",
];
// O resumo de pendências é de quem administra.
const ADMIN_ONLY: readonly NotificationCategory[] = ["PENDING_SUMMARY"];

/** As categorias que fazem sentido para o tipo de usuário (as das preferências). */
export function categoriesFor(type: UserType): NotificationCategory[] {
  return NOTIFICATION_CATEGORIES.filter((category) => {
    if (PROFESSIONAL_ONLY.includes(category)) return type === "PROFESSIONAL";
    if (ADMIN_ONLY.includes(category)) return type === "ADMIN";
    return true;
  });
}
