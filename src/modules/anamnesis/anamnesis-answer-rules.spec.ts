import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  AnswerableQuestion,
  parseIsoDate,
  resolveAnswers,
  validateAnswerValue,
} from "./anamnesis-answer-rules";

const question = (
  overrides: Partial<AnswerableQuestion> = {},
): AnswerableQuestion => ({
  id: "q1",
  label: "Pergunta",
  type: "SHORT_TEXT",
  isRequired: false,
  options: [],
  detailLabel: null,
  ...overrides,
});

const messageOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).message;
  }
  return undefined;
};

describe("parseIsoDate", () => {
  it("aceita datas que existem, inclusive 29/02 de ano bissexto", () => {
    expect(parseIsoDate("2026-10-27")?.toISOString()).toBe(
      "2026-10-27T00:00:00.000Z",
    );
    expect(parseIsoDate("2028-02-29")).not.toBeNull();
  });

  it.each([
    "2026-02-30",
    "2027-02-29",
    "2026-13-01",
    "27/10/2026",
    "2026-1-1",
    "",
  ])("recusa %j", (value) => {
    expect(parseIsoDate(value)).toBeNull();
  });
});

describe("validateAnswerValue", () => {
  const choices = ["Corrida", "Natação"];

  it.each([
    ["SHORT_TEXT", {}, "Ana"],
    ["LONG_TEXT", {}, "Texto longo"],
    ["SINGLE_CHOICE", { options: choices }, "Corrida"],
    ["MULTIPLE_CHOICE", { options: choices }, ["Corrida", "Natação"]],
    ["NUMBER", {}, 72.5],
    ["NUMBER", {}, 0],
    ["DATE", {}, "2026-10-27"],
    ["SCALE", {}, 0],
    ["SCALE", {}, 10],
    ["YES_NO", {}, { answer: false }],
    ["YES_NO", { detailLabel: "Qual?" }, { answer: true, detail: "Dipirona" }],
    ["YES_NO", { detailLabel: "Qual?" }, { answer: true }],
  ] as const)("aceita %s com %j", (type, extra, value) => {
    expect(validateAnswerValue(question({ type, ...extra }), value)).toEqual(
      value,
    );
  });

  it.each([
    ["SHORT_TEXT", {}, ""],
    ["SHORT_TEXT", {}, "   "],
    ["SHORT_TEXT", {}, 5],
    ["LONG_TEXT", {}, "a".repeat(5001)],
    ["SINGLE_CHOICE", { options: choices }, "Outra"],
    ["SINGLE_CHOICE", { options: choices }, ["Corrida"]],
    ["MULTIPLE_CHOICE", { options: choices }, []],
    ["MULTIPLE_CHOICE", { options: choices }, "Corrida"],
    ["MULTIPLE_CHOICE", { options: choices }, ["Corrida", "Corrida"]],
    ["MULTIPLE_CHOICE", { options: choices }, ["Outra"]],
    ["NUMBER", {}, "10"],
    ["NUMBER", {}, Infinity],
    ["NUMBER", {}, null],
    ["DATE", {}, "2026-02-30"],
    ["DATE", {}, 20261027],
    ["SCALE", {}, 11],
    ["SCALE", {}, -1],
    ["SCALE", {}, 5.5],
    ["YES_NO", {}, true],
    ["YES_NO", {}, { answer: "sim" }],
    ["YES_NO", {}, { answer: true, extra: 1 }],
    ["YES_NO", {}, { answer: true, detail: "Qual" }],
    ["YES_NO", { detailLabel: "Qual?" }, { answer: false, detail: "x" }],
    ["YES_NO", { detailLabel: "Qual?" }, { answer: true, detail: "" }],
  ] as const)("recusa %s com %j", (type, extra, value) => {
    expect(
      messageOf(() => validateAnswerValue(question({ type, ...extra }), value)),
    ).toContain('Resposta da pergunta "Pergunta"');
  });

  it("aceita texto com exatamente 5.000 caracteres", () => {
    expect(() =>
      validateAnswerValue(question(), "a".repeat(5000)),
    ).not.toThrow();
  });
});

describe("resolveAnswers", () => {
  const questions = [
    question({ id: "q1", label: "Alergia", type: "YES_NO", isRequired: true }),
    question({ id: "q2", label: "Dor", type: "SCALE" }),
    question({ id: "q3", label: "Queixa", isRequired: true }),
  ];

  it("devolve as respostas validadas", () => {
    expect(
      resolveAnswers(
        questions,
        [
          { questionId: "q1", value: { answer: false } },
          { questionId: "q3", value: "Dor lombar" },
        ],
        { requireAll: true },
      ),
    ).toEqual([
      { questionId: "q1", value: { answer: false } },
      { questionId: "q3", value: "Dor lombar" },
    ]);
  });

  it("no registro inicial, lista as obrigatórias sem resposta", () => {
    expect(
      messageOf(() =>
        resolveAnswers(questions, [{ questionId: "q2", value: 3 }], {
          requireAll: true,
        }),
      ),
    ).toBe('Perguntas obrigatórias sem resposta: "Alergia", "Queixa"');
  });

  it("no acompanhamento, aceita só as perguntas que mudaram", () => {
    expect(
      resolveAnswers(questions, [{ questionId: "q2", value: 3 }], {
        requireAll: false,
      }),
    ).toEqual([{ questionId: "q2", value: 3 }]);
    expect(resolveAnswers(questions, [], { requireAll: false })).toEqual([]);
  });

  it("recusa pergunta de outra ficha e pergunta repetida", () => {
    expect(
      messageOf(() =>
        resolveAnswers(questions, [{ questionId: "outra", value: 1 }], {
          requireAll: false,
        }),
      ),
    ).toContain("não pertence a esta ficha");
    expect(
      messageOf(() =>
        resolveAnswers(
          questions,
          [
            { questionId: "q2", value: 1 },
            { questionId: "q2", value: 2 },
          ],
          { requireAll: false },
        ),
      ),
    ).toContain('"Dor" foi respondida mais de uma vez');
  });

  it("valida o valor pelo tipo da pergunta", () => {
    expect(
      messageOf(() =>
        resolveAnswers(questions, [{ questionId: "q2", value: 11 }], {
          requireAll: false,
        }),
      ),
    ).toContain("de 0 a 10");
  });
});
