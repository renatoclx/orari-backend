import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { validateQuestions } from "./anamnesis-question-rules";
import { AnamnesisQuestionDto } from "./dto/anamnesis-question.dto";

const question = (
  overrides: Partial<AnamnesisQuestionDto> = {},
): AnamnesisQuestionDto => ({
  label: "Pergunta",
  type: "SHORT_TEXT",
  ...overrides,
});

const messageOf = (questions: AnamnesisQuestionDto[]) => {
  try {
    validateQuestions(questions);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).message;
  }
  return undefined;
};

describe("validateQuestions", () => {
  it("aceita perguntas válidas de todos os tipos", () => {
    expect(
      messageOf([
        question({ type: "SHORT_TEXT" }),
        question({ type: "LONG_TEXT", options: [] }),
        question({ type: "YES_NO", detailLabel: "Qual?" }),
        question({ type: "SINGLE_CHOICE", options: ["A", "B"] }),
        question({ type: "MULTIPLE_CHOICE", options: ["A", "B", "C"] }),
        question({ type: "NUMBER" }),
        question({ type: "DATE" }),
        question({ type: "SCALE" }),
      ]),
    ).toBeUndefined();
  });

  it.each(["SINGLE_CHOICE", "MULTIPLE_CHOICE"] as const)(
    "%s exige ao menos 2 opções",
    (type) => {
      expect(messageOf([question({ type })])).toBe(
        "Pergunta 1: informe ao menos 2 opções",
      );
      expect(messageOf([question({ type, options: ["A"] })])).toContain(
        "ao menos 2 opções",
      );
    },
  );

  it("recusa opções repetidas, ignorando acento e maiúsculas, e indica a pergunta", () => {
    expect(
      messageOf([
        question(),
        question({ type: "SINGLE_CHOICE", options: ["Não", "nao"] }),
      ]),
    ).toBe("Pergunta 2: as opções não podem se repetir");
  });

  it.each(["SHORT_TEXT", "YES_NO", "NUMBER", "DATE", "SCALE"] as const)(
    "%s não aceita opções",
    (type) => {
      expect(messageOf([question({ type, options: ["A"] })])).toBe(
        "Pergunta 1: este tipo de pergunta não aceita opções",
      );
    },
  );

  it("o texto de detalhe só vale para sim ou não", () => {
    expect(
      messageOf([question({ type: "SHORT_TEXT", detailLabel: "Qual?" })]),
    ).toBe(
      "Pergunta 1: o texto de detalhe só vale para perguntas de sim ou não",
    );
  });
});
