// @Type (class-transformer) depende do reflect-metadata, que em runtime é carregado pelo Nest.
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreatePlanDto } from "./create-plan.dto";

const base = {
  name: "Pilates + Fisio",
  monthlyPrice: 450,
  serviceIds: ["8f14e45f-ceea-4c6a-9f1b-6d2f1c3b7a10"],
};
const period = { months: 3, discountPercent: 10, monthlyDiscountPercent: 5 };

async function errorsFor(payload: object) {
  const errors = await validate(plainToInstance(CreatePlanDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe("CreatePlanDto", () => {
  it("deve aceitar plano com serviço e período válidos", async () => {
    await expect(errorsFor({ ...base, periods: [period] })).resolves.toEqual(
      [],
    );
  });

  it("deve exigir ao menos um serviço", async () => {
    await expect(errorsFor({ ...base, serviceIds: [] })).resolves.toEqual([
      "serviceIds",
    ]);
  });

  it("deve recusar serviço repetido", async () => {
    const serviceId = base.serviceIds[0];

    await expect(
      errorsFor({ ...base, serviceIds: [serviceId, serviceId] }),
    ).resolves.toEqual(["serviceIds"]);
  });

  it.each([
    { months: 0 },
    { discountPercent: 100.5 },
    { monthlyDiscountPercent: -1 },
    { discountPercent: 10.555 },
  ])("deve recusar período inválido %o", async (change) => {
    await expect(
      errorsFor({ ...base, periods: [{ ...period, ...change }] }),
    ).resolves.toEqual(["periods"]);
  });

  it("deve exigir os dois percentuais do período", async () => {
    await expect(
      errorsFor({ ...base, periods: [{ months: 3, discountPercent: 10 }] }),
    ).resolves.toEqual(["periods"]);
  });
});
