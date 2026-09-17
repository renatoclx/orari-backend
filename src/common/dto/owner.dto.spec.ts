import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateContactDto } from "../../modules/contact/dto/create-contact.dto";
import { UpdateContactDto } from "../../modules/contact/dto/update-contact.dto";

const COMPANY_ID = "8f14e45f-ceea-4c6a-9f1b-6d2f1c3b7a10";
const PEOPLE_ID = "c9f0f895-fb98-4b91-8c1d-2a3e4b5c6d7e";

const base = {
  type: "MAIN",
  phone: "31999999999",
  email: "contato@orari.com",
};

const validationOptions = { whitelist: true, forbidNonWhitelisted: true };

async function errorsFor(payload: object) {
  const errors = await validate(
    plainToInstance(CreateContactDto, payload),
    validationOptions,
  );
  return errors.map((error) => error.property);
}

describe("OwnerDto (dono exclusivo)", () => {
  it("deve aceitar apenas companyId", async () => {
    await expect(
      errorsFor({ ...base, companyId: COMPANY_ID }),
    ).resolves.toEqual([]);
  });

  it("deve aceitar apenas peopleId", async () => {
    await expect(errorsFor({ ...base, peopleId: PEOPLE_ID })).resolves.toEqual(
      [],
    );
  });

  it("deve rejeitar quando nenhum dono é informado", async () => {
    await expect(errorsFor(base)).resolves.toContain("companyId");
  });

  it("deve rejeitar quando os dois donos são informados", async () => {
    await expect(
      errorsFor({ ...base, companyId: COMPANY_ID, peopleId: PEOPLE_ID }),
    ).resolves.toContain("companyId");
  });

  it("deve rejeitar dono com UUID inválido", async () => {
    await expect(
      errorsFor({ ...base, peopleId: "nao-e-uuid" }),
    ).resolves.toContain("peopleId");
  });

  it("não deve permitir trocar o dono na atualização", async () => {
    const errors = await validate(
      plainToInstance(UpdateContactDto, { companyId: COMPANY_ID }),
      validationOptions,
    );

    expect(errors.map((error) => error.property)).toEqual(["companyId"]);
  });

  it("deve permitir atualização parcial sem dono", async () => {
    const errors = await validate(
      plainToInstance(UpdateContactDto, { email: "novo@orari.com" }),
      validationOptions,
    );

    expect(errors).toEqual([]);
  });
});
