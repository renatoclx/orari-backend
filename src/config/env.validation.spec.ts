import { describe, expect, it } from "vitest";
import { validateEnv } from "./env.validation";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/orari",
  JWT_SECRET: "um-segredo-qualquer",
  JWT_EXPIRES_IN: "15m",
  JWT_REFRESH_EXPIRES_IN: "7d",
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

  it("deve listar todos os problemas de uma vez", () => {
    expect(() => validateEnv({})).toThrow(
      /DATABASE_URL[\s\S]*JWT_SECRET[\s\S]*JWT_EXPIRES_IN[\s\S]*JWT_REFRESH_EXPIRES_IN/,
    );
  });
});
