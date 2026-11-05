import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PortalAuthGuard } from "./portal-auth.guard";
import { PortalAuthService } from "./portal-auth.service";

describe("PortalAuthGuard", () => {
  const serviceMock = { authenticate: vi.fn(), resolveClient: vi.fn() };
  const guard = new PortalAuthGuard(
    serviceMock as unknown as PortalAuthService,
  );
  const contextFor = (request: object) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;
  const account = { sessionId: "s-1", accountId: "acc-1" };

  beforeEach(() => {
    vi.clearAllMocks();
    serviceMock.authenticate.mockResolvedValue(account);
  });

  it("rota da conta: guarda só a conta na requisição", async () => {
    const request = { headers: { authorization: "Bearer abc" }, params: {} };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(serviceMock.authenticate).toHaveBeenCalledWith("abc");
    expect(serviceMock.resolveClient).not.toHaveBeenCalled();
    expect(request).toMatchObject({ portalAccount: account });
  });

  it("rota de um local: guarda também o cadastro da conta nessa clínica", async () => {
    const client = { ...account, companyId: "c-1", peopleId: "p-1" };
    serviceMock.resolveClient.mockResolvedValue(client);
    const request = {
      headers: { authorization: "Bearer abc" },
      params: { slug: "aurora" },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(serviceMock.resolveClient).toHaveBeenCalledWith(account, "aurora");
    expect(request).toMatchObject({ portalClient: client });
  });

  it.each([
    ["sem cabeçalho", {}],
    ["outro esquema", { authorization: "Basic abc" }],
    ["Bearer vazio", { authorization: "Bearer " }],
  ])("%s: 401 sem consultar", async (_, headers) => {
    await expect(
      guard.canActivate(contextFor({ headers, params: { slug: "aurora" } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(serviceMock.authenticate).not.toHaveBeenCalled();
  });
});
