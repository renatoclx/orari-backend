import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import * as bcrypt from "bcrypt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyService } from "../company/company.service";
import { UserService } from "../user/user.service";
import { AuthService } from "./auth.service";

vi.mock("bcrypt", () => ({
  compare: vi.fn(),
}));

describe("AuthService", () => {
  let authService: AuthService;

  const userServiceMock = {
    findByEmailWithPassword: vi.fn(),
  };
  const companyServiceMock = {
    isActive: vi.fn(),
  };
  const jwtServiceMock = {
    signAsync: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userServiceMock },
        { provide: CompanyService, useValue: companyServiceMock },
        { provide: JwtService, useValue: jwtServiceMock },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  describe("login", () => {
    const dto = { email: "test@example.com", password: "123456" };
    const user = {
      id: "user-1",
      email: dto.email,
      password: "hashed-password",
      companyId: "company-1",
    };

    it("deve retornar um accessToken quando as credenciais são válidas", async () => {
      userServiceMock.findByEmailWithPassword.mockResolvedValue(user);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      companyServiceMock.isActive.mockResolvedValue(true);
      jwtServiceMock.signAsync.mockResolvedValue("signed-token");

      const result = await authService.login(dto);

      expect(userServiceMock.findByEmailWithPassword).toHaveBeenCalledWith(
        dto.email,
      );
      expect(bcrypt.compare).toHaveBeenCalledWith(dto.password, user.password);
      expect(companyServiceMock.isActive).toHaveBeenCalledWith("company-1");
      expect(jwtServiceMock.signAsync).toHaveBeenCalledWith({
        sub: user.id,
        email: user.email,
      });
      expect(result).toEqual({ accessToken: "signed-token" });
    });

    it("deve lançar UnauthorizedException quando o usuário não existe", async () => {
      userServiceMock.findByEmailWithPassword.mockResolvedValue(null);

      await expect(authService.login(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
    });

    it("deve lançar UnauthorizedException quando a empresa do usuário está inativa", async () => {
      userServiceMock.findByEmailWithPassword.mockResolvedValue(user);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      companyServiceMock.isActive.mockResolvedValue(false);

      await expect(authService.login(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
    });

    it("deve lançar UnauthorizedException quando a senha não confere", async () => {
      userServiceMock.findByEmailWithPassword.mockResolvedValue(user);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(authService.login(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(companyServiceMock.isActive).not.toHaveBeenCalled();
      expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
    });
  });
});
