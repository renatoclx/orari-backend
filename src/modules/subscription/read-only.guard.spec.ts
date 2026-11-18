import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminUser,
  COMPANY_ID,
  superAdminUser,
} from "../../../test/fixtures/authenticated-users";
import { ReadOnlyGuard } from "./read-only.guard";
import { SubscriptionService } from "./subscription.service";

describe("ReadOnlyGuard", () => {
  const reflectorMock = { getAllAndOverride: vi.fn() };
  const subscriptionMock = { assertWritable: vi.fn() };
  let guard: ReadOnlyGuard;

  function route(meta: { isPublic?: boolean; allowReadOnly?: boolean }) {
    reflectorMock.getAllAndOverride.mockImplementation((key: string) => {
      if (key === "isPublic") return meta.isPublic;
      if (key === "allowReadOnly") return meta.allowReadOnly;
      return undefined;
    });
  }

  const contextFor = (user: unknown, method: string): ExecutionContext =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user, method }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    vi.clearAllMocks();
    route({});
    guard = new ReadOnlyGuard(
      reflectorMock as unknown as Reflector,
      subscriptionMock as unknown as SubscriptionService,
    );
  });

  it("leitura passa sem consultar a assinatura", async () => {
    await expect(guard.canActivate(contextFor(adminUser, "GET"))).resolves.toBe(
      true,
    );
    expect(subscriptionMock.assertWritable).not.toHaveBeenCalled();
  });

  it("gravação confere a assinatura da empresa do usuário", async () => {
    await expect(
      guard.canActivate(contextFor(adminUser, "POST")),
    ).resolves.toBe(true);
    expect(subscriptionMock.assertWritable).toHaveBeenCalledWith(COMPANY_ID);
  });

  it("em somente leitura, a recusa do serviço sobe", async () => {
    subscriptionMock.assertWritable.mockRejectedValue(new ForbiddenException());
    await expect(
      guard.canActivate(contextFor(adminUser, "PATCH")),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("SUPER_ADMIN, rota pública e @AllowReadOnly não são barrados", async () => {
    await guard.canActivate(contextFor(superAdminUser, "DELETE"));
    route({ isPublic: true });
    await guard.canActivate(contextFor(undefined, "POST"));
    route({ allowReadOnly: true });
    await guard.canActivate(contextFor(adminUser, "PATCH"));
    expect(subscriptionMock.assertWritable).not.toHaveBeenCalled();
  });
});
