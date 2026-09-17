import { describe, expect, it } from "vitest";
import { isValidCnpj, isValidCpf } from "./document.validator";

describe("isValidCpf", () => {
  it.each(["52998224725", "11144477735", "12345678909"])(
    "aceita o CPF válido %s",
    (cpf) => {
      expect(isValidCpf(cpf)).toBe(true);
    },
  );

  it.each([
    ["dígito verificador errado", "12345678901"],
    ["sequência repetida", "11111111111"],
    ["com máscara", "529.982.247-25"],
    ["tamanho errado", "5299822472"],
    ["com letras", "5299822472A"],
  ])("recusa %s (%s)", (_case, cpf) => {
    expect(isValidCpf(cpf)).toBe(false);
  });
});

describe("isValidCnpj", () => {
  it.each([
    ["numérico", "11222333000181"],
    ["numérico", "11444777000161"],
    ["alfanumérico (exemplo da Receita Federal)", "12ABC34501DE35"],
  ])("aceita o CNPJ %s %s", (_format, cnpj) => {
    expect(isValidCnpj(cnpj)).toBe(true);
  });

  it.each([
    ["dígito verificador errado", "11222333000182"],
    ["alfanumérico com dígito errado", "12ABC34501DE36"],
    ["sequência repetida", "00000000000000"],
    ["com máscara", "11.222.333/0001-81"],
    ["minúsculas (normalizadas antes, no DTO)", "12abc34501de35"],
    ["letra nos dígitos verificadores", "12ABC34501DE3A"],
    ["tamanho errado", "1122233300018"],
  ])("recusa %s (%s)", (_case, cnpj) => {
    expect(isValidCnpj(cnpj)).toBe(false);
  });
});
