import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateContactDto } from "./create-contact.dto";

const base = {
  type: "MAIN",
  companyId: "8f14e45f-ceea-4c6a-9f1b-6d2f1c3b7a10",
};

async function errorsFor(payload: object) {
  const errors = await validate(plainToInstance(CreateContactDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe("CreateContactDto (telefone e/ou e-mail)", () => {
  it("deve aceitar apenas telefone", async () => {
    await expect(errorsFor({ ...base, phone: "31999999999" })).resolves.toEqual(
      [],
    );
  });

  it("deve aceitar apenas e-mail", async () => {
    await expect(
      errorsFor({ ...base, email: "contato@orari.com" }),
    ).resolves.toEqual([]);
  });

  it("deve rejeitar quando nenhum dos dois é informado", async () => {
    await expect(errorsFor(base)).resolves.toContain("phone");
  });

  it("deve validar o formato do e-mail quando informado", async () => {
    await expect(
      errorsFor({ ...base, phone: "31999999999", email: "invalido" }),
    ).resolves.toEqual(["email"]);
  });
});
