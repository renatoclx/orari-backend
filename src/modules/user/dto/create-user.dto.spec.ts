import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateUserDto } from "./create-user.dto";
import { ResetPasswordDto } from "./reset-password.dto";
import { UpdateUserDto } from "./update-user.dto";

const validationOptions = { whitelist: true, forbidNonWhitelisted: true };

const payload = {
  name: "Maria",
  email: "maria@orari.com",
  password: "senha-forte",
  passwordConfirmation: "senha-forte",
  type: "USER",
};

async function errorsFor<T extends object>(cls: new () => T, body: object) {
  const errors = await validate(plainToInstance(cls, body), validationOptions);
  return errors.map((error) => error.property);
}

describe("CreateUserDto", () => {
  it("deve aceitar um payload válido", async () => {
    await expect(errorsFor(CreateUserDto, payload)).resolves.toEqual([]);
  });

  it("deve rejeitar confirmação de senha diferente", async () => {
    await expect(
      errorsFor(CreateUserDto, { ...payload, passwordConfirmation: "outra" }),
    ).resolves.toEqual(["passwordConfirmation"]);
  });

  it("deve rejeitar senha com menos de 8 caracteres", async () => {
    await expect(
      errorsFor(CreateUserDto, {
        ...payload,
        password: "curta",
        passwordConfirmation: "curta",
      }),
    ).resolves.toEqual(["password"]);
  });

  it("deve rejeitar tipo de usuário inexistente", async () => {
    await expect(
      errorsFor(CreateUserDto, { ...payload, type: "CLIENT" }),
    ).resolves.toEqual(["type"]);
  });

  it("deve aceitar companyId opcional (o alcance é verificado no service)", async () => {
    await expect(
      errorsFor(CreateUserDto, {
        ...payload,
        companyId: "8f14e45f-ceea-4c6a-9f1b-6d2f1c3b7a10",
      }),
    ).resolves.toEqual([]);
  });

  it("deve recusar companyId que não é UUID", async () => {
    await expect(
      errorsFor(CreateUserDto, { ...payload, companyId: "empresa" }),
    ).resolves.toEqual(["companyId"]);
  });

  it("deve aceitar o tipo SUPER_ADMIN (a permissão é verificada no service)", async () => {
    await expect(
      errorsFor(CreateUserDto, { ...payload, type: "SUPER_ADMIN" }),
    ).resolves.toEqual([]);
  });
});

describe("UpdateUserDto", () => {
  it.each(["password", "passwordConfirmation", "companyId"])(
    "não deve aceitar %s na atualização",
    async (property) => {
      await expect(
        errorsFor(UpdateUserDto, { [property]: "valor" }),
      ).resolves.toEqual([property]);
    },
  );

  it("deve aceitar atualização parcial", async () => {
    await expect(errorsFor(UpdateUserDto, { type: "ADMIN" })).resolves.toEqual(
      [],
    );
  });
});

describe("ResetPasswordDto", () => {
  it("deve aceitar nova senha confirmada", async () => {
    await expect(
      errorsFor(ResetPasswordDto, {
        newPassword: "nova-senha",
        newPasswordConfirmation: "nova-senha",
      }),
    ).resolves.toEqual([]);
  });

  it("deve rejeitar confirmação diferente", async () => {
    await expect(
      errorsFor(ResetPasswordDto, {
        newPassword: "nova-senha",
        newPasswordConfirmation: "outra-senha",
      }),
    ).resolves.toEqual(["newPasswordConfirmation"]);
  });

  it("deve aplicar as mesmas regras de tamanho do cadastro", async () => {
    await expect(
      errorsFor(ResetPasswordDto, {
        newPassword: "a".repeat(73),
        newPasswordConfirmation: "a".repeat(73),
      }),
    ).resolves.toEqual(["newPassword"]);
  });
});
