import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminUser,
  COMPANY_ID,
  superAdminUser,
} from "../../../test/fixtures/authenticated-users";
import { CompanyAccessService } from "./company-access.service";
import { actionFromMethod, FeatureAccessGuard } from "./feature-access.guard";

describe("actionFromMethod", () => {
  it("traduz o verbo HTTP na ação", () => {
    expect(actionFromMethod("GET")).toBe("view");
    expect(actionFromMethod("get")).toBe("view");
    expect(actionFromMethod("POST")).toBe("create");
    expect(actionFromMethod("PATCH")).toBe("edit");
    expect(actionFromMethod("PUT")).toBe("edit");
    expect(actionFromMethod("DELETE")).toBe("remove");
  });
});

describe("FeatureAccessGuard", () => {
  const reflectorMock = { getAllAndOverride: vi.fn() };
  const accessMock = { can: vi.fn() };
  let guard: FeatureAccessGuard;

  // Metadados da rota: público, funcionalidade e ação.
  function route(meta: {
    isPublic?: boolean;
    feature?: string;
    action?: string;
  }) {
    reflectorMock.getAllAndOverride.mockImplementation((key: string) => {
      if (key === "isPublic") return meta.isPublic;
      if (key === "feature") return meta.feature;
      if (key === "featureAction") return meta.action;
      return undefined;
    });
  }

  const contextFor = (user: unknown, method = "GET"): ExecutionContext =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user, method }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    vi.clearAllMocks();
    guard = new FeatureAccessGuard(
      reflectorMock as unknown as Reflector,
      accessMock as unknown as CompanyAccessService,
    );
  });

  it("rota pública passa sem consultar", async () => {
    route({ isPublic: true, feature: "class-groups" });
    await expect(guard.canActivate(contextFor(undefined))).resolves.toBe(true);
    expect(accessMock.can).not.toHaveBeenCalled();
  });

  it("rota sem @Feature não é limitada por plano", async () => {
    route({});
    await expect(guard.canActivate(contextFor(adminUser))).resolves.toBe(true);
    expect(accessMock.can).not.toHaveBeenCalled();
  });

  it("SUPER_ADMIN passa sem consultar", async () => {
    route({ feature: "class-groups" });
    await expect(guard.canActivate(contextFor(superAdminUser))).resolves.toBe(
      true,
    );
    expect(accessMock.can).not.toHaveBeenCalled();
  });

  it("empresa com a ação liberada passa; a ação vem do verbo", async () => {
    route({ feature: "class-groups" });
    accessMock.can.mockResolvedValue(true);

    await expect(
      guard.canActivate(contextFor(adminUser, "POST")),
    ).resolves.toBe(true);
    expect(accessMock.can).toHaveBeenCalledWith(
      COMPANY_ID,
      "class-groups",
      "create",
    );
  });

  it("a ação explícita da rota vale mais que o verbo", async () => {
    route({ feature: "class-groups", action: "remove" });
    accessMock.can.mockResolvedValue(true);

    await guard.canActivate(contextFor(adminUser, "PATCH"));

    expect(accessMock.can).toHaveBeenCalledWith(
      COMPANY_ID,
      "class-groups",
      "remove",
    );
  });

  it("sem a ação liberada responde 403 com o código FEATURE_NOT_IN_PLAN", async () => {
    route({ feature: "class-groups" });
    accessMock.can.mockResolvedValue(false);

    const error = await guard
      .canActivate(contextFor(adminUser))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      statusCode: 403,
      code: "FEATURE_NOT_IN_PLAN",
    });
  });
});
