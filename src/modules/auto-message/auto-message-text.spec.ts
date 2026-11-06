import { describe, expect, it } from "vitest";
import {
  AUTO_MESSAGE_CATALOG,
  AUTO_MESSAGE_KINDS,
} from "./auto-message.catalog";
import {
  firstName,
  renderMessage,
  unknownVariables,
} from "./auto-message-text";

describe("unknownVariables", () => {
  it("aceita as variáveis do agendamento nas situações de agendamento", () => {
    expect(
      unknownVariables(
        "{nome} {estabelecimento} {data} {hora} {servico} {profissional}",
        "REMINDER",
      ),
    ).toEqual([]);
  });

  it("aniversário e falta não têm data, hora, serviço nem profissional", () => {
    expect(
      unknownVariables("{nome}, dia {data} às {hora}", "BIRTHDAY"),
    ).toEqual(["data", "hora"]);
  });

  it("aponta a variável inventada uma vez só", () => {
    expect(unknownVariables("{Nome} e {Nome} e {cpf}", "MISS_YOU")).toEqual([
      "Nome",
      "cpf",
    ]);
  });

  it("chaves soltas ou com espaço não são variáveis", () => {
    expect(unknownVariables("Promo {} de { nome } :{", "MISS_YOU")).toEqual([]);
  });

  it("os textos padrão usam só variáveis válidas", () => {
    for (const kind of AUTO_MESSAGE_KINDS) {
      expect(
        unknownVariables(AUTO_MESSAGE_CATALOG[kind].defaults.body, kind),
      ).toEqual([]);
    }
  });
});

describe("renderMessage", () => {
  it("troca cada variável, inclusive repetida", () => {
    expect(
      renderMessage("{nome}, {servico} às {hora}. Até lá, {nome}!", {
        nome: "Ana",
        servico: "Pilates",
        hora: "09:00",
      }),
    ).toBe("Ana, Pilates às 09:00. Até lá, Ana!");
  });

  it("variável sem valor fica como está", () => {
    expect(renderMessage("Oi {nome} {data}", { nome: "Ana" })).toBe(
      "Oi Ana {data}",
    );
  });
});

describe("firstName", () => {
  it("o primeiro nome, sem os espaços", () => {
    expect(firstName("  Maria Clara Souza ")).toBe("Maria");
    expect(firstName("Ana")).toBe("Ana");
  });
});
