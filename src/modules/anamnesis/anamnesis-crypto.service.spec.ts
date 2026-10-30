import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AnamnesisCryptoService } from "./anamnesis-crypto.service";

const newKey = () => randomBytes(32).toString("base64");
const serviceWith = (key: string) =>
  new AnamnesisCryptoService({
    getOrThrow: () => key,
  } as unknown as ConfigService);

describe("AnamnesisCryptoService", () => {
  const service = serviceWith(newKey());

  it("devolve o texto original, inclusive com acentos e emoji", () => {
    const text = "Alergia a dipirona — dor lombar há 3 meses 😬";

    expect(service.decrypt(service.encrypt(text))).toBe(text);
  });

  it("cifra texto vazio", () => {
    expect(service.decrypt(service.encrypt(""))).toBe("");
  });

  it("não guarda o texto às claras e usa o prefixo de versão", () => {
    const stored = service.encrypt("diabetes tipo 2");

    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("diabetes");
    expect(
      Buffer.from(stored.slice(3), "base64").toString("utf8"),
    ).not.toContain("diabetes");
  });

  it("gera valores diferentes para o mesmo texto (IV novo a cada gravação)", () => {
    expect(service.encrypt("igual")).not.toBe(service.encrypt("igual"));
  });

  it("recusa valor com a chave errada", () => {
    const stored = service.encrypt("segredo");

    expect(() => serviceWith(newKey()).decrypt(stored)).toThrow(
      "Não foi possível decifrar",
    );
  });

  it("recusa valor adulterado (autenticação do GCM)", () => {
    const stored = service.encrypt("segredo");
    const bytes = Buffer.from(stored.slice(3), "base64");
    bytes[bytes.length - 1] ^= 1;

    expect(() => service.decrypt(`v1:${bytes.toString("base64")}`)).toThrow(
      "Não foi possível decifrar",
    );
  });

  it("recusa valor com a tag de autenticação truncada", () => {
    // Texto vazio: o valor é só IV (12 bytes) + tag (16). Mantendo 4 bytes da tag,
    // sem o tamanho fixo o GCM conferiria apenas esses 4 e aceitaria o valor.
    const bytes = Buffer.from(service.encrypt("").slice(3), "base64");
    const truncated = bytes.subarray(0, 16);

    expect(() => service.decrypt(`v1:${truncated.toString("base64")}`)).toThrow(
      "Não foi possível decifrar",
    );
  });

  it("recusa formato desconhecido", () => {
    expect(() => service.decrypt("texto puro")).toThrow("Formato");
    expect(() => service.decrypt("v9:abc")).toThrow("Formato");
  });
});
