import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateStockMovementDto } from "./create-stock-movement.dto";

const uuid = "11111111-1111-4111-8111-111111111111";

async function errorsFor(payload: object) {
  const errors = await validate(
    plainToInstance(CreateStockMovementDto, payload),
    {
      whitelist: true,
      forbidNonWhitelisted: true,
    },
  );
  return errors.map((error) => error.property);
}

describe("CreateStockMovementDto", () => {
  it("aceita compra com custo e conta a pagar", async () => {
    await expect(
      errorsFor({
        type: "PURCHASE",
        quantity: 2,
        unitCost: 9.9,
        payable: { categoryId: uuid, dueDate: "2026-11-20" },
      }),
    ).resolves.toEqual([]);
  });

  it("aceita saída e ajuste sem custo (o ajuste aceita 0)", async () => {
    await expect(errorsFor({ type: "LOSS", quantity: 1 })).resolves.toEqual([]);
    await expect(
      errorsFor({ type: "ADJUSTMENT", quantity: 0 }),
    ).resolves.toEqual([]);
  });

  it.each([
    ["compra sem custo", { type: "PURCHASE", quantity: 1 }, "unitCost"],
    ["saldo inicial à mão", { type: "INITIAL", quantity: 1 }, "type"],
    ["quantidade fracionada", { type: "LOSS", quantity: 1.5 }, "quantity"],
    ["quantidade negativa", { type: "LOSS", quantity: -1 }, "quantity"],
    [
      "custo com três casas",
      { type: "PURCHASE", quantity: 1, unitCost: 1.234 },
      "unitCost",
    ],
    [
      "vencimento fora do formato",
      {
        type: "PURCHASE",
        quantity: 1,
        unitCost: 1,
        payable: { categoryId: uuid, dueDate: "20/11/2026" },
      },
      "payable",
    ],
  ])("recusa %s", async (_, payload, property) => {
    await expect(errorsFor(payload)).resolves.toEqual([property]);
  });
});
