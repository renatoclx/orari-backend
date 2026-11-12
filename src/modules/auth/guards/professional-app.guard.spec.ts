import "reflect-metadata";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { UserType } from "../../../../generated/prisma/enums";
import { IS_PUBLIC_KEY } from "../../../common/decorators/public.decorator";
import { PROFESSIONAL_APP_KEY } from "../../../common/decorators/professional-app.decorator";
import { ProfessionalAppGuard } from "./professional-app.guard";

// Controller de mentira: as funções (e não métodos) evitam o aviso de `this`
// solto do eslint, e a marca vai no próprio handler, como o Nest faz.
class Controller {}
const open = () => undefined;
const marked = () => undefined;
Reflect.defineMetadata(PROFESSIONAL_APP_KEY, true, marked);

function contextFor(
  handler: () => void,
  type?: UserType,
  controller: object = Controller,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ user: type ? { id: "u1", type } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

describe("ProfessionalAppGuard", () => {
  const guard = new ProfessionalAppGuard(new Reflector());

  it("o PROFESSIONAL só passa em rota marcada com @ProfessionalApp()", () => {
    expect(guard.canActivate(contextFor(marked, UserType.PROFESSIONAL))).toBe(
      true,
    );
    expect(() =>
      guard.canActivate(contextFor(open, UserType.PROFESSIONAL)),
    ).toThrow(ForbiddenException);
  });

  it.each([UserType.SUPER_ADMIN, UserType.ADMIN])(
    "%s não é afetado, com ou sem a marca",
    (type) => {
      expect(guard.canActivate(contextFor(open, type))).toBe(true);
      expect(guard.canActivate(contextFor(marked, type))).toBe(true);
    },
  );

  it("rota pública passa para qualquer um", () => {
    const login = () => undefined;
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, login);

    expect(guard.canActivate(contextFor(login, UserType.PROFESSIONAL))).toBe(
      true,
    );
    expect(guard.canActivate(contextFor(login))).toBe(true);
  });

  it("a chave da marca é a mesma que o decorator grava", () => {
    expect(Reflect.getMetadata(PROFESSIONAL_APP_KEY, marked)).toBe(true);
  });
});
