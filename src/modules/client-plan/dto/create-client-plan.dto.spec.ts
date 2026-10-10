// @Type (class-transformer) depende do reflect-metadata, que em runtime é carregado pelo Nest.
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateClientPlanDto } from "./create-client-plan.dto";

const uuid = "8f14e45f-ceea-4c6a-9f1b-6d2f1c3b7a10";
const base = {
  clientId: uuid,
  planId: uuid,
  months: 3,
  schedules: [
    {
      serviceId: uuid,
      professionalId: uuid,
      days: [{ weekDay: "MONDAY", startTime: "10:00", endTime: "11:00" }],
    },
  ],
};

async function errorsFor(payload: object) {
  const errors = await validate(plainToInstance(CreateClientPlanDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe("CreateClientPlanDto (primeiro vencimento)", () => {
  it("deve exigir firstDueDate no mensal", async () => {
    await expect(
      errorsFor({ ...base, billingType: "MONTHLY" }),
    ).resolves.toEqual(["firstDueDate"]);
  });

  it("deve aceitar o mensal com firstDueDate", async () => {
    await expect(
      errorsFor({
        ...base,
        billingType: "MONTHLY",
        firstDueDate: "2026-10-31",
      }),
    ).resolves.toEqual([]);
  });

  it("deve aceitar o integral sem firstDueDate", async () => {
    await expect(
      errorsFor({ ...base, billingType: "INTEGRAL" }),
    ).resolves.toEqual([]);
  });

  it("deve validar o formato quando informado no integral", async () => {
    await expect(
      errorsFor({
        ...base,
        billingType: "INTEGRAL",
        firstDueDate: "não é data",
      }),
    ).resolves.toEqual(["firstDueDate"]);
  });
});
