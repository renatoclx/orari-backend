/**
 * Limites de tentativas por IP nas rotas que recebem credencial. Barram a
 * tentativa de senhas em massa; acima do limite, a API responde 429.
 */
export const AUTH_THROTTLER = "auth";

// Login: 5 tentativas por minuto.
export const LOGIN_LIMIT = { limit: 5, ttl: 60_000 };

// Refresh: mais folga, porque o front renova sozinho (ex.: várias abas abertas).
export const REFRESH_LIMIT = { limit: 20, ttl: 60_000 };
