import { describe, expect, it } from "vitest";
import { normalizeForSearch } from "./normalize-for-search";

describe("normalizeForSearch", () => {
  it.each([
    ["São Paulo", "sao paulo"],
    ["Mogi Guaçu", "mogi guacu"],
    ["AÇAILÂNDIA", "acailandia"],
    ["Pau D'Arco", "pau d'arco"],
    ["  João  ", "joão".normalize("NFD").replace(/\p{M}/gu, "")],
    ["Itaóca", "itaoca"],
    ["Ñandú Über", "nandu uber"],
  ])("normaliza %j para %j", (input, expected) => {
    expect(normalizeForSearch(input)).toBe(expected);
  });

  it("trata a forma já composta e a decomposta do mesmo texto igualmente", () => {
    const composed = "São";
    const decomposed = "São";

    expect(normalizeForSearch(composed)).toBe(normalizeForSearch(decomposed));
  });
});
