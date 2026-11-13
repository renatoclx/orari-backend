/**
 * Anúncios do que o usuário faz no sistema. O módulo de autenticação só anuncia,
 * depois de entrar; quem quiser reagir (as boas-vindas) escuta, sem que os
 * módulos dependam um do outro.
 */
export const USER_EVENTS = {
  // O usuário entrou com sucesso (e-mail no painel ou telefone no app).
  loggedIn: "user.logged-in",
} as const;

export interface UserLoggedInEvent {
  userId: string;
}
