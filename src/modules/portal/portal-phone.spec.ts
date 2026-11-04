import { describe, expect, it } from "vitest";
import { normalizePortalPhone } from "./portal-phone";

describe("normalizePortalPhone", () => {
  it("aceita máscara e devolve só os dígitos com DDD", () => {
    expect(normalizePortalPhone("(31) 98888-7777")).toBe("31988887777");
    expect(normalizePortalPhone("31 3333-4444")).toBe("3133334444");
  });

  it("tira o código do país (55)", () => {
    expect(normalizePortalPhone("+55 31 98888-7777")).toBe("31988887777");
    expect(normalizePortalPhone("553133334444")).toBe("3133334444");
  });

  it("recusa o que não é telefone com DDD", () => {
    for (const bad of ["", "98888-7777", "123", "319888877771234", "abc"]) {
      expect(normalizePortalPhone(bad)).toBeUndefined();
    }
  });
});
