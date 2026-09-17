import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyService } from "../../company/company.service";
import { UserService } from "../../user/user.service";
import { JwtStrategy } from "./jwt.strategy";

describe("JwtStrategy", () => {
  const userServiceMock = { findActiveById: vi.fn() };
  const companyServiceMock = { isActive: vi.fn() };
  const strategy = new JwtStrategy(
    { get: () => "test-secret" } as unknown as ConfigService,
    userServiceMock as unknown as UserService,
    companyServiceMock as unknown as CompanyService,
  );

  const payload = { sub: "user-1", email: "maria@orari.com" };
  const user = {
    id: "user-1",
    name: "Maria",
    email: "maria@orari.com",
    type: "ADMIN",
    companyId: "company-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deve montar o request.user com tipo e empresa do usuário", async () => {
    userServiceMock.findActiveById.mockResolvedValue(user);
    companyServiceMock.isActive.mockResolvedValue(true);

    await expect(strategy.validate(payload)).resolves.toEqual({
      id: "user-1",
      email: "maria@orari.com",
      type: "ADMIN",
      companyId: "company-1",
    });
    expect(userServiceMock.findActiveById).toHaveBeenCalledWith("user-1");
    expect(companyServiceMock.isActive).toHaveBeenCalledWith("company-1");
  });

  it("deve recusar token de usuário excluído", async () => {
    userServiceMock.findActiveById.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(companyServiceMock.isActive).not.toHaveBeenCalled();
  });

  it("deve recusar token de usuário de empresa inativa", async () => {
    userServiceMock.findActiveById.mockResolvedValue(user);
    companyServiceMock.isActive.mockResolvedValue(false);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
