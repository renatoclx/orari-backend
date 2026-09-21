// @Type (class-transformer) depende do reflect-metadata, que em runtime é carregado pelo Nest.
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreatePeopleDto } from "./create-people.dto";

const payload = {
  name: "Maria",
  document: "52998224725",
  birthDate: "1990-05-20",
  type: "CLIENT",
};

async function errorsFor(body: object) {
  const errors = await validate(plainToInstance(CreatePeopleDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe("CreatePeopleDto", () => {
  it("deve aceitar um payload válido", async () => {
    await expect(errorsFor(payload)).resolves.toEqual([]);
  });

  it("deve recusar CPF inválido", async () => {
    await expect(
      errorsFor({ ...payload, document: "12345678901" }),
    ).resolves.toEqual(["document"]);
  });

  it("não deve aceitar companyId: a empresa vem do usuário autenticado", async () => {
    await expect(
      errorsFor({
        ...payload,
        companyId: "8f14e45f-ceea-4c6a-9f1b-6d2f1c3b7a10",
      }),
    ).resolves.toEqual(["companyId"]);
  });
});
