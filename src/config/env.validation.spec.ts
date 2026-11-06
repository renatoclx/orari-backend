import { describe, expect, it } from "vitest";
import { validateEnv } from "./env.validation";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/orari",
  JWT_SECRET: "um-segredo-qualquer",
  JWT_EXPIRES_IN: "15m",
  JWT_REFRESH_EXPIRES_IN: "7d",
  // 32 bytes em base64.
  ANAMNESIS_ENCRYPTION_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
};

const production = {
  ...base,
  NODE_ENV: "production",
  JWT_SECRET: "x".repeat(40),
  CORS_ORIGIN: "https://app.orari.com.br",
};

describe("validateEnv", () => {
  it("deve aceitar a configuração de desenvolvimento e devolvê-la", () => {
    expect(validateEnv(base)).toEqual(base);
  });

  it("deve aceitar a configuração de produção", () => {
    expect(validateEnv(production)).toEqual(production);
  });

  it.each(["DATABASE_URL", "JWT_SECRET"])("deve exigir %s", (name) => {
    expect(() => validateEnv({ ...base, [name]: undefined })).toThrow(name);
    expect(() => validateEnv({ ...base, [name]: "  " })).toThrow(name);
  });

  it("deve exigir a chave da anamnese em qualquer ambiente", () => {
    const withoutKey = { ...base, ANAMNESIS_ENCRYPTION_KEY: undefined };

    expect(() => validateEnv(withoutKey)).toThrow("ANAMNESIS_ENCRYPTION_KEY");
    expect(() => validateEnv({ ...production, ...withoutKey })).toThrow(
      "ANAMNESIS_ENCRYPTION_KEY",
    );
  });

  it.each([
    ["curta demais", "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"],
    ["16 bytes", "AAECAwQFBgcICQoLDA0ODw=="],
    ["64 bytes", "A".repeat(86) + "=="],
    ["texto comum", "uma-senha-qualquer-que-nao-e-base64-valido!!"],
  ])("deve recusar a chave da anamnese %s", (_, key) => {
    expect(() =>
      validateEnv({ ...base, ANAMNESIS_ENCRYPTION_KEY: key }),
    ).toThrow("ANAMNESIS_ENCRYPTION_KEY");
  });

  it.each(["JWT_EXPIRES_IN", "JWT_REFRESH_EXPIRES_IN"])(
    "deve exigir %s como duração válida",
    (name) => {
      expect(() => validateEnv({ ...base, [name]: undefined })).toThrow(name);
      expect(() => validateEnv({ ...base, [name]: "abc" })).toThrow(name);
    },
  );

  it.each([
    ["PORT", "abc"],
    ["TRUST_PROXY", "um"],
    ["TRUST_PROXY", "-1"],
    ["SWAGGER_ENABLED", "talvez"],
  ])("deve recusar %s com valor %s", (name, value) => {
    expect(() => validateEnv({ ...base, [name]: value })).toThrow(name);
  });

  it("deve aceitar os opcionais com valor válido", () => {
    expect(() =>
      validateEnv({
        ...base,
        PORT: "3333",
        TRUST_PROXY: "1",
        SWAGGER_ENABLED: "false",
      }),
    ).not.toThrow();
  });

  describe("em produção", () => {
    it("deve recusar segredo curto", () => {
      expect(() => validateEnv({ ...production, JWT_SECRET: "curto" })).toThrow(
        "JWT_SECRET deve ter ao menos 32",
      );
    });

    it("deve recusar o segredo de exemplo, mesmo comprido", () => {
      expect(() =>
        validateEnv({
          ...production,
          JWT_SECRET: `change-me-${"x".repeat(40)}`,
        }),
      ).toThrow("valor de exemplo");
    });

    it("deve exigir CORS_ORIGIN", () => {
      expect(() =>
        validateEnv({ ...production, CORS_ORIGIN: undefined }),
      ).toThrow("CORS_ORIGIN");
    });

    it("não deve cobrar essas regras fora de produção", () => {
      expect(() =>
        validateEnv({ ...base, NODE_ENV: "development", JWT_SECRET: "curto" }),
      ).not.toThrow();
    });
  });

  describe("chaves dos avisos do app (VAPID)", () => {
    // Par só de teste (npx web-push generate-vapid-keys); não é usado em lugar nenhum.
    const vapid = {
      VAPID_PUBLIC_KEY:
        "BKXdATi84x3TVYjFJcfTuRLai29aLuL0ZO0hiZH32k6sOXHEnq0o-W3tolk-i_WqaJEXoj8P1tJ8s3kahXp_tTY",
      VAPID_PRIVATE_KEY: "9usGQ1GhGlto5PA72tbCoUJCvsVWsR7qDqE6PLoC56U",
      VAPID_SUBJECT: "mailto:contato@orariapp.com.br",
    };

    it("deve aceitar sem nenhuma (avisos desligados) e com as três válidas", () => {
      expect(() => validateEnv(base)).not.toThrow();
      expect(() => validateEnv({ ...base, ...vapid })).not.toThrow();
    });

    it("deve recusar só uma parte das três", () => {
      expect(() =>
        validateEnv({ ...base, VAPID_PUBLIC_KEY: vapid.VAPID_PUBLIC_KEY }),
      ).toThrow("vão juntas");
    });

    it("deve recusar chave e contato fora do formato", () => {
      expect(() =>
        validateEnv({
          ...base,
          ...vapid,
          VAPID_PUBLIC_KEY: "curta",
          VAPID_PRIVATE_KEY: vapid.VAPID_PUBLIC_KEY,
          VAPID_SUBJECT: "contato@orariapp.com.br",
        }),
      ).toThrow(/VAPID_PUBLIC_KEY[\s\S]*VAPID_PRIVATE_KEY[\s\S]*VAPID_SUBJECT/);
    });
  });

  it("deve listar todos os problemas de uma vez", () => {
    expect(() => validateEnv({})).toThrow(
      /DATABASE_URL[\s\S]*JWT_SECRET[\s\S]*JWT_EXPIRES_IN[\s\S]*JWT_REFRESH_EXPIRES_IN/,
    );
  });
});
