import ms from "ms";

// Tamanho mínimo do segredo do JWT em produção.
const MIN_PRODUCTION_SECRET_LENGTH = 32;

// As variáveis de ambiente são sempre texto (ou ausentes).
type Env = Record<string, string | undefined>;

const isText = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== "";

/**
 * Confere as variáveis de ambiente na subida da API: ela se recusa a iniciar,
 * com a lista do que está errado, em vez de falhar depois (ou, pior, subir com
 * configuração fraca). Usada pelo ConfigModule.
 *
 * Em produção (NODE_ENV=production) as regras são mais rígidas: segredo forte e
 * CORS com lista de origens.
 */
export function validateEnv(config: Env): Env {
  const errors: string[] = [];
  const isProduction = config.NODE_ENV === "production";

  if (!isText(config.DATABASE_URL)) {
    errors.push("DATABASE_URL é obrigatória");
  }

  if (!isText(config.JWT_SECRET)) {
    errors.push("JWT_SECRET é obrigatório");
  } else if (isProduction) {
    const secret = config.JWT_SECRET;
    if (secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
      errors.push(
        `JWT_SECRET deve ter ao menos ${MIN_PRODUCTION_SECRET_LENGTH} caracteres em produção`,
      );
    }
    if (secret.toLowerCase().startsWith("change-me")) {
      errors.push("JWT_SECRET não pode ser o valor de exemplo em produção");
    }
  }

  for (const name of ["JWT_EXPIRES_IN", "JWT_REFRESH_EXPIRES_IN"] as const) {
    const value = config[name];
    // O ms devolve undefined para um texto que não é uma duração (ex.: "abc").
    if (!isText(value) || ms(value as ms.StringValue) === undefined) {
      errors.push(`${name} deve ser uma duração válida (ex.: 15m, 1h, 7d)`);
    }
  }

  if (isProduction && !isText(config.CORS_ORIGIN)) {
    errors.push(
      "CORS_ORIGIN é obrigatória em produção (origens separadas por vírgula)",
    );
  }

  if (config.PORT !== undefined && !/^\d+$/.test(config.PORT)) {
    errors.push("PORT deve ser um número");
  }

  if (config.TRUST_PROXY !== undefined && !/^\d+$/.test(config.TRUST_PROXY)) {
    errors.push("TRUST_PROXY deve ser o número de proxies à frente da API");
  }

  if (
    config.SWAGGER_ENABLED !== undefined &&
    !["true", "false"].includes(config.SWAGGER_ENABLED)
  ) {
    errors.push("SWAGGER_ENABLED deve ser true ou false");
  }

  if (errors.length > 0) {
    throw new Error(
      `Configuração inválida:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }

  return config;
}
