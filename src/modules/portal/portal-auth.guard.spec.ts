import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PortalAuthGuard } from "./portal-auth.guard";
import { PortalAuthService } from "./portal-auth.service";

describe("PortalAuthGuard", () => {
  const serviceMock = { authenticate: vi.fn() };
  const guard = new PortalAuthGuard(
    serviceMock as unknown as PortalAuthService,
  );
  const contextFor = (request: object) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  beforeEach(() => vi.clearAllMocks());

  it("token do portal válido: passa e guarda o cliente na requisição", async () => {
    const client = { sessionId: "s-1", companyId: "c-1", peopleId: "p-1" };
    serviceMock.authenticate.mockResolvedValue(client);
    const request = {
      headers: { authorization: "Bearer abc" },
      params: { slug: "aurora" },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(serviceMock.authenticate).toHaveBeenCalledWith("aurora", "abc");
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
