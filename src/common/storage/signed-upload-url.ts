import { createHmac, timingSafeEqual } from "node:crypto";
import { UPLOADS_PUBLIC_PREFIX } from "./local-file-storage.service";

/**
 * Links assinados das fotos privadas (ver docs/technical-debt.md, "Fotos em
 * pasta local"). O banco guarda o caminho puro (/uploads/people/<uuid>.jpg); a
 * resposta da API leva o caminho com validade e assinatura
 * (?exp=<segundos>&sig=<hmac>), e o /uploads só entrega a foto privada com uma
 * assinatura válida e dentro do prazo. As logos (companies) seguem públicas.
 */

// Pastas com dados pessoais: fotos de pessoas, de produtos e da conta do portal.
export const PRIVATE_UPLOAD_FOLDERS = [
  "people",
  "products",
  "client-accounts",
] as const;

// Caminho exato que o LocalFileStorage grava: pasta privada, UUID e extensão.
const PRIVATE_PATH = new RegExp(
  `^${UPLOADS_PUBLIC_PREFIX}/(${PRIVATE_UPLOAD_FOLDERS.join("|")})/[0-9a-f-]{36}\\.(jpg|png)$`,
);

// Janela da validade: o link vale até o fim da hora seguinte. Dentro da mesma
// hora, o link é igual, e o navegador reaproveita a foto do cache.
const WINDOW_SECONDS = 60 * 60;

export function isPrivateUploadPath(value: string): boolean {
  return PRIVATE_PATH.test(value);
}

// A pasta de um caminho de /uploads (ex.: "people"), ou null.
export function uploadFolderOf(path: string): string | null {
  const prefix = `${UPLOADS_PUBLIC_PREFIX}/`;
  if (!path.startsWith(prefix)) {
    return null;
  }
  const folder = path.slice(prefix.length).split("/")[0];
  return folder || null;
}

// A chave da assinatura sai do JWT_SECRET, com um rótulo próprio: não é preciso
// mais um segredo no .env, e a assinatura não serve como token nem o contrário.
function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("orari:uploads").digest();
}

function signatureOf(path: string, exp: number, secret: string): string {
  return createHmac("sha256", signingKey(secret))
    .update(`${path}:${exp}`)
    .digest("base64url");
}

/** O caminho com a validade (fim da hora seguinte) e a assinatura. */
export function signUploadPath(
  path: string,
  secret: string,
  now = Date.now(),
): string {
  const nowSeconds = Math.floor(now / 1000);
  const exp =
    Math.ceil((nowSeconds + 1) / WINDOW_SECONDS) * WINDOW_SECONDS +
    WINDOW_SECONDS;

  return `${path}?exp=${exp}&sig=${signatureOf(path, exp, secret)}`;
}

/**
 * Confere a assinatura e a validade de um caminho privado. A comparação é em
 * tempo constante, para não dar pistas da assinatura certa.
 */
export function isValidUploadSignature(
  path: string,
  exp: unknown,
  sig: unknown,
  secret: string,
  now = Date.now(),
): boolean {
  if (
    typeof exp !== "string" ||
    typeof sig !== "string" ||
    !/^\d+$/.test(exp)
  ) {
    return false;
  }
  const expSeconds = Number(exp);
  if (expSeconds * 1000 <= now) {
    return false;
  }
  const expected = Buffer.from(signatureOf(path, expSeconds, secret));
  const given = Buffer.from(sig);

  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Segundos que faltam para o link vencer (para o Cache-Control). */
export function secondsUntil(exp: string, now = Date.now()): number {
  return Math.max(Number(exp) - Math.floor(now / 1000), 0);
}
