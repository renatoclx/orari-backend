import { describe, expect, it } from "vitest";
import {
  generateCode,
  generateSessionToken,
  hashCode,
  hashSessionToken,
  sameHash,
} from "./portal-code";

describe("código do portal", () => {
  it("tem sempre 6 dígitos", () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it("o hash depende do segredo, da empresa, do telefone e do código", () => {
    const base = hashCode("segredo", "c1", "31988887777", "123456");
    expect(hashCode("segredo", "c1", "31988887777", "123456")).toBe(base);
    expect(hashCode("outro", "c1", "31988887777", "123456")).not.toBe(base);
    expect(hashCode("segredo", "c2", "31988887777", "123456")).not.toBe(base);
    expect(hashCode("segredo", "c1", "31988887770", "123456")).not.toBe(base);
    expect(hashCode("segredo", "c1", "31988887777", "123457")).not.toBe(base);
  });

  it("sameHash compara sem falhar em tamanhos diferentes", () => {
    expect(sameHash("abc", "abc")).toBe(true);
    expect(sameHash("abc", "abd")).toBe(false);
    expect(sameHash("abc", "abcd")).toBe(false);
  });
});

describe("token da sessão", () => {
  it("só o hash vai ao banco, e ele confere com o token", () => {
    const { token, tokenHash } = generateSessionToken();
    expect(token).not.toBe(tokenHash);
    expect(hashSessionToken(token)).toBe(tokenHash);
  });

  it("cada token é diferente", () => {
    expect(generateSessionToken().token).not.toBe(generateSessionToken().token);
  });
});
