import { describe, expect, it } from "vitest";
import { profitMarginOf } from "./product-pricing";

describe("profitMarginOf (margem sobre a venda)", () => {
  it.each([
    [100, 60, "40"],
    [80, 50, "37.5"],
    // 2/3 de 100: arredonda na segunda casa.
    [30, 10, "66.67"],
    // Custo igual à venda: sem margem.
    [50, 50, "0"],
    // Custo acima da venda: margem negativa.
    [50, 75, "-50"],
    // Sem erro de ponto flutuante (0,1 + 0,2).
    [0.3, 0.1, "66.67"],
  ])("venda %s e custo %s dão %s%%", (sale, cost, expected) => {
    expect(profitMarginOf(sale, cost).toString()).toBe(expected);
  });
});
