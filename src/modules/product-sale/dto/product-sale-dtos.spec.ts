import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateProductSaleDto } from "./create-product-sale.dto";

const uuid = "11111111-1111-4111-8111-111111111111";

async function errorsFor(payload: object) {
  const errors = await validate(
    plainToInstance(CreateProductSaleDto, payload),
    {
      whitelist: true,
      forbidNonWhitelisted: true,
    },
  );
  return errors.map((error) => error.property);
}

describe("CreateProductSaleDto", () => {
  const item = { productId: uuid, quantity: 1, unitPrice: 10.5 };

  it("aceita cliente e itens", async () => {
    await expect(errorsFor({ clientId: uuid, items: [item] })).resolves.toEqual(
      [],
    );
  });

  it.each([
    ["sem itens", { clientId: uuid, items: [] }, "items"],
    ["cliente inválido", { clientId: "x", items: [item] }, "clientId"],
    [
      "quantidade zero",
      { clientId: uuid, items: [{ ...item, quantity: 0 }] },
      "items",
    ],
    [
      "valor com três casas",
      { clientId: uuid, items: [{ ...item, unitPrice: 1.234 }] },
      "items",
    ],
    [
      "valor zero",
      { clientId: uuid, items: [{ ...item, unitPrice: 0 }] },
      "items",
    ],
  ])("recusa %s", async (_, payload, property) => {
    await expect(errorsFor(payload)).resolves.toEqual([property]);
  });
});
