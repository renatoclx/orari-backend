import { describe, expect, it } from "vitest";
import { currentFichas, replacementOf } from "./anamnesis-replacement";

describe("currentFichas", () => {
  it("fica só com a ficha de maior versão de cada modelo, na ordem original", () => {
    const fichas = [
      { id: "a1", templateId: "a", version: 1 },
      { id: "b1", templateId: "b", version: 1 },
      { id: "a3", templateId: "a", version: 3 },
      { id: "a2", templateId: "a", version: 2 },
    ];

    expect(currentFichas(fichas).map((ficha) => ficha.id)).toEqual([
      "b1",
      "a3",
    ]);
  });
});

describe("replacementOf", () => {
  const siblings = [
    { id: "v1", version: 1 },
    { id: "v3", version: 3 },
    { id: "v4", version: 4 },
  ];

  it("a ficha antiga aponta a atual (a de maior versão) e as anteriores", () => {
    expect(replacementOf({ version: 2 }, siblings)).toEqual({
      replacedBy: { id: "v4", version: 4 },
      previous: [{ id: "v1", version: 1 }],
    });
  });

  it("a ficha atual não é substituída e lista as anteriores da mais recente para a mais antiga", () => {
    expect(replacementOf({ version: 5 }, siblings)).toEqual({
      replacedBy: null,
      previous: [
        { id: "v4", version: 4 },
        { id: "v3", version: 3 },
        { id: "v1", version: 1 },
      ],
    });
  });

  it("sem outras fichas do modelo, nada a mostrar", () => {
    expect(replacementOf({ version: 1 }, [])).toEqual({
      replacedBy: null,
      previous: [],
    });
  });
});
