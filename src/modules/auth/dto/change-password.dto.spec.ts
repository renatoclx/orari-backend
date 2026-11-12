import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { ChangePasswordDto } from "./change-password.dto";

const valid = {
  currentPassword: "Senha@Antiga1",
  newPassword: "Nova@Senha123",
  newPasswordConfirmation: "Nova@Senha123",
};

async function errorsFor(payload: object) {
  const errors = await validate(plainToInstance(ChangePasswordDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe("ChangePasswordDto", () => {
  it("aceita a senha atual e uma nova forte, com a confirmação", async () => {
    await expect(errorsFor(valid)).resolves.toEqual([]);
  });

  it.each([
    ["sem a atual", { ...valid, currentPassword: "" }, "currentPassword"],
    [
      "nova fraca",
      { ...valid, newPassword: "123", newPasswordConfirmation: "123" },
      "newPassword",
    ],
    [
      "confirmação diferente",
      { ...valid, newPasswordConfirmation: "x" },
      "newPasswordConfirmation",
    ],
    ["campo estranho", { ...valid, type: "ADMIN" }, "type"],
  ])("recusa %s", async (_, payload, property) => {
    await expect(errorsFor(payload)).resolves.toContain(property);
  });
});
