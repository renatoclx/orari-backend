import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

// Regras do código e da sessão do portal (ver docs/business-rules.md, "Portal do cliente").
export const CODE_TTL_MS = 10 * 60_000;
export const MAX_CODE_ATTEMPTS = 5;
// Depois de conferido, o código vale este tempo para escolher a pessoa e criar a sessão.
export const VERIFIED_TTL_MS = 10 * 60_000;
export const SESSION_TTL_MS = 90 * 24 * 60 * 60_000;
// Pedidos de código por telefone: no máximo 3 em 10 minutos e 10 em 24 horas.
export const CODE_REQUEST_LIMITS = [
  { max: 3, windowMs: 10 * 60_000 },
  { max: 10, windowMs: 24 * 60 * 60_000 },
] as const;

/** Código de 6 dígitos, com zeros à esquerda (ex.: "048213"). */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Hash do código, amarrado à empresa e ao telefone. HMAC com o segredo da API:
 * com só um milhão de códigos possíveis, um SHA-256 puro seria quebrado por
 * força bruta se a tabela vazasse.
 */
export function hashCode(
  secret: string,
  companyId: string,
  phone: string,
  code: string,
): string {
  return createHmac("sha256", secret)
    .update(`${companyId}:${phone}:${code}`)
    .digest("hex");
}

/** Comparação em tempo constante (não revela quantos caracteres batem). */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Token opaco da sessão (vai ao cliente) e o hash que fica no banco. */
export function generateSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
