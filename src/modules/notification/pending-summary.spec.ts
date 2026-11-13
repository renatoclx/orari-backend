import { describe, expect, it } from "vitest";
import {
  itemPhrase,
  joinPhrases,
  SUMMARY_ITEM_FEATURE,
  summaryText,
} from "./pending-summary";
import { SUMMARY_ITEMS } from "../auto-message/auto-message.catalog";

describe("itemPhrase", () => {
  it("usa o singular só para um", () => {
    expect(itemPhrase({ item: "PAYABLE_OVERDUE", count: 1 })).toBe(
      "1 conta atrasada",
    );
    expect(itemPhrase({ item: "PAYABLE_OVERDUE", count: 3 })).toBe(
      "3 contas atrasadas",
    );
    expect(itemPhrase({ item: "BIRTHDAYS", count: 4 })).toBe(
      "4 aniversariantes",
    );
    expect(itemPhrase({ item: "OPEN_TABS", count: 1 })).toBe("1 comanda hoje");
  });
});

describe("joinPhrases", () => {
  it("junta com vírgula e o último com 'e'", () => {
    expect(joinPhrases([])).toBe("");
    expect(joinPhrases(["a"])).toBe("a");
    expect(joinPhrases(["a", "b"])).toBe("a e b");
    expect(joinPhrases(["a", "b", "c"])).toBe("a, b e c");
  });
});

describe("summaryText", () => {
  it("escreve só o que tem número, na ordem recebida", () => {
    expect(
      summaryText([
        { item: "PAYABLE_TODAY", count: 3 },
        { item: "PAYABLE_OVERDUE", count: 0 },
        { item: "RECEIVABLE_OVERDUE", count: 5 },
        { item: "BIRTHDAYS", count: 1 },
      ]),
    ).toBe(
      "3 contas a pagar hoje, 5 recebimentos atrasados e 1 aniversariante",
    );
  });

  it("sem nada com número, não há texto (o resumo não sai)", () => {
    expect(summaryText([{ item: "OPEN_TABS", count: 0 }])).toBe("");
    expect(summaryText([])).toBe("");
  });
});

describe("SUMMARY_ITEM_FEATURE", () => {
  it("todo item do catálogo tem a funcionalidade do plano que o alimenta", () => {
    for (const item of SUMMARY_ITEMS) {
      expect(SUMMARY_ITEM_FEATURE[item]).toBeTruthy();
    }
  });
});
