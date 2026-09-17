import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IS_PUBLIC_KEY } from "../../../common/decorators/public.decorator";
import { ROLES_KEY } from "../../../common/decorators/roles.decorator";
import { RolesGuard } from "./roles.guard";

function contextWithUser(user?: { type: string }) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe("RolesGuard", () => {
  const reflector = { getAllAndOverride: vi.fn() };
  const guard = new RolesGuard(reflector as unknown as Reflector);

  const metadata = (values: Record<string, unknown>) =>
    reflector.getAllAndOverride.mockImplementation(
      (key: string) => values[key],
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deve liberar rotas públicas", () => {
    metadata({ [IS_PUBLIC_KEY]: true, [ROLES_KEY]: ["ADMIN"] });

    expect(guard.canActivate(contextWithUser())).toBe(true);
  });

  it("deve liberar rotas sem restrição de tipo", () => {
    metadata({});

    expect(guard.canActivate(contextWithUser({ type: "USER" }))).toBe(true);
  });

  it("deve liberar quando o tipo do usuário é permitido", () => {
    metadata({ [ROLES_KEY]: ["ADMIN"] });

    expect(guard.canActivate(contextWithUser({ type: "ADMIN" }))).toBe(true);
  });

  it("deve bloquear quando o tipo do usuário não é permitido", () => {
    metadata({ [ROLES_KEY]: ["ADMIN"] });

    expect(guard.canActivate(contextWithUser({ type: "USER" }))).toBe(false);
  });

  it("deve bloquear quando não há usuário na requisição", () => {
    metadata({ [ROLES_KEY]: ["ADMIN"] });

    expect(guard.canActivate(contextWithUser())).toBe(false);
  });
});
