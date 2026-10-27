import { describe, expect, it } from "vitest";
import {
  ageInYears,
  formatAddress,
  formatAnswer,
  formatDate,
  formatDateTime,
  formatDocument,
  formatPhone,
} from "./anamnesis-pdf-format";

const SP = "America/Sao_Paulo";

describe("formatDate / formatDateTime", () => {
  it("formata data de coluna date como dd/mm/aaaa", () => {
    expect(formatDate(new Date("2026-01-05T00:00:00Z"))).toBe("05/01/2026");
  });

  it("formata o instante no relógio da empresa", () => {
    // 02:30 UTC de 28/10 ainda é 27/10 às 23:30 em São Paulo.
    expect(formatDateTime(new Date("2026-10-28T02:30:00Z"), SP)).toBe(
      "27/10/2026 23:30",
    );
  });
});

describe("ageInYears", () => {
  const now = new Date("2026-10-27T15:00:00Z");

  it.each([
    ["1990-10-27", 36],
    ["1990-10-28", 35],
    ["1990-10-26", 36],
    ["2026-01-01", 0],
  ])("nascimento %s tem %i anos", (birth, expected) => {
    expect(ageInYears(new Date(`${birth}T00:00:00Z`), now, SP)).toBe(expected);
  });

  it("devolve null sem data de nascimento", () => {
    expect(ageInYears(null, now, SP)).toBeNull();
  });

  it("conta a data de hoje no fuso da empresa, não em UTC", () => {
    // Em UTC já é 28/10, mas em São Paulo ainda é 27/10: o aniversário de 28/10 não chegou.
    expect(
      ageInYears(
        new Date("1990-10-28T00:00:00Z"),
        new Date("2026-10-28T01:00:00Z"),
        SP,
      ),
    ).toBe(35);
  });
});

describe("máscaras", () => {
  it("CPF, CNPJ numérico e alfanumérico", () => {
    expect(formatDocument("12345678909")).toBe("123.456.789-09");
    expect(formatDocument("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatDocument("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
    expect(formatDocument("123")).toBe("123");
  });

  it("telefone de 10 e de 11 dígitos", () => {
    expect(formatPhone("3133334444")).toBe("(31) 3333-4444");
    expect(formatPhone("31999998888")).toBe("(31) 99999-8888");
    expect(formatPhone("0800")).toBe("0800");
  });
});

describe("formatAddress", () => {
  const address = {
    cep: "30123456",
    street: "Rua das Flores",
    number: "100",
    complement: "apto 2",
    neighborhood: "Centro",
    city: { name: "Belo Horizonte", state: { acronym: "MG" } },
  };

  it("junta rua, bairro, cidade e CEP", () => {
    expect(formatAddress(address)).toBe(
      "Rua das Flores, 100, apto 2 - Centro - Belo Horizonte/MG - CEP 30123-456",
    );
  });

  it("omite complemento e bairro ausentes", () => {
    expect(
      formatAddress({ ...address, complement: null, neighborhood: null }),
    ).toBe("Rua das Flores, 100 - Belo Horizonte/MG - CEP 30123-456");
  });
});

describe("formatAnswer", () => {
  const q = (type: string, detailLabel: string | null = null) =>
    ({ type, detailLabel }) as never;

  it.each([
    ["SHORT_TEXT", null, "Ana", "Ana"],
    ["SINGLE_CHOICE", null, "Casado", "Casado"],
    ["MULTIPLE_CHOICE", null, ["Corrida", "Natação"], "Corrida, Natação"],
    ["YES_NO", "Qual?", { answer: false }, "Não"],
    ["YES_NO", "Qual?", { answer: true }, "Sim"],
    [
      "YES_NO",
      "Qual?",
      { answer: true, detail: "Dipirona" },
      "Sim — Qual?: Dipirona",
    ],
    ["YES_NO", null, { answer: true, detail: "x" }, "Sim — Detalhe: x"],
    ["DATE", null, "2026-10-20", "20/10/2026"],
    ["NUMBER", null, 72.5, "72,5"],
    ["NUMBER", null, 1234, "1.234"],
    ["SCALE", null, 7, "7 de 10"],
  ])("%s → texto", (type, detailLabel, value, expected) => {
    expect(formatAnswer(q(type, detailLabel), value as never)).toBe(expected);
  });

  it("sem resposta, um traço", () => {
    expect(formatAnswer(q("SHORT_TEXT"), undefined)).toBe("—");
  });
});
