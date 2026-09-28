import { createHash } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import * as bcrypt from "bcrypt";
import ms from "ms";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { UserService } from "../user/user.service";
import { AuthService } from "./auth.service";

vi.mock("bcrypt", () => ({
  compare: vi.fn(),
}));

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const anyDate: unknown = expect.any(Date);

describe("AuthService", () => {
  let authService: AuthService;

  const userServiceMock = {
    findByEmailWithPassword: vi.fn(),
    findActiveById: vi.fn(),
  };
  const companyServiceMock = {
    isActive: vi.fn(),
  };
  const jwtServiceMock = {
    signAsync: vi.fn(),
  };
  const configServiceMock = {
    get: vi.fn(),
  };
  const prismaMock = {
    refreshToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    configServiceMock.get.mockReturnValue("7d");
    prismaMock.refreshToken.create.mockResolvedValue({});
    prismaMock.refreshToken.update.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userServiceMock },
        { provide: CompanyService, useValue: companyServiceMock },
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: PrismaService, useValue: prismaMock },
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

    it("deve retornar accessToken e refreshToken quando as credenciais são válidas", async () => {
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
      expect(result.accessToken).toBe("signed-token");

      // O refresh token bruto nunca é persistido: só o seu hash.
      expect(prismaMock.refreshToken.create).toHaveBeenCalledWith({
        data: {
          userId: user.id,
          tokenHash: hash(result.refreshToken),
          expiresAt: anyDate,
        },
      });

      const call = prismaMock.refreshToken.create.mock.calls[0] as [
        { data: { expiresAt: Date } },
      ];
      const expectedExpiry = Date.now() + ms("7d");
      expect(
        Math.abs(call[0].data.expiresAt.getTime() - expectedExpiry),
      ).toBeLessThan(2000);
    });

    it("deve lançar UnauthorizedException quando o usuário não existe", async () => {
      userServiceMock.findByEmailWithPassword.mockResolvedValue(null);

      await expect(authService.login(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it("deve lançar UnauthorizedException quando a empresa do usuário está inativa", async () => {
      userServiceMock.findByEmailWithPassword.mockResolvedValue(user);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      companyServiceMock.isActive.mockResolvedValue(false);

      await expect(authService.login(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
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

  describe("refresh", () => {
    const rawToken = "raw-refresh-token";
    const user = {
      id: "user-1",
      email: "test@example.com",
      companyId: "company-1",
    };
    const storedToken = {
      id: "token-1",
      userId: user.id,
      tokenHash: hash(rawToken),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };

    it("deve rotacionar o refresh token e emitir um novo par quando válido", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(storedToken);
      userServiceMock.findActiveById.mockResolvedValue(user);
      companyServiceMock.isActive.mockResolvedValue(true);
      jwtServiceMock.signAsync.mockResolvedValue("new-access-token");

      const result = await authService.refresh({ refreshToken: rawToken });

      expect(prismaMock.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: hash(rawToken) },
      });
      // O token usado é revogado antes de qualquer outra checagem (rotação).
      expect(prismaMock.refreshToken.update).toHaveBeenCalledWith({
        where: { id: storedToken.id },
        data: { revokedAt: anyDate },
      });
      expect(userServiceMock.findActiveById).toHaveBeenCalledWith(user.id);
      expect(result.accessToken).toBe("new-access-token");
      expect(result.refreshToken).not.toBe(rawToken);
      expect(prismaMock.refreshToken.create).toHaveBeenCalledWith({
        data: {
          userId: user.id,
          tokenHash: hash(result.refreshToken),
          expiresAt: anyDate,
        },
      });
    });

    it("deve lançar UnauthorizedException quando o token não existe", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(null);

      await expect(
        authService.refresh({ refreshToken: rawToken }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prismaMock.refreshToken.update).not.toHaveBeenCalled();
    });

    it("deve lançar UnauthorizedException quando o token já foi revogado", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        ...storedToken,
        revokedAt: new Date(),
      });

      await expect(
        authService.refresh({ refreshToken: rawToken }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prismaMock.refreshToken.update).not.toHaveBeenCalled();
    });

    it("deve lançar UnauthorizedException quando o token expirou", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        ...storedToken,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        authService.refresh({ refreshToken: rawToken }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prismaMock.refreshToken.update).not.toHaveBeenCalled();
    });

    it("deve revogar o token mas recusar quando o usuário não está mais ativo", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(storedToken);
      userServiceMock.findActiveById.mockResolvedValue(null);

      await expect(
        authService.refresh({ refreshToken: rawToken }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prismaMock.refreshToken.update).toHaveBeenCalled();
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it("deve revogar o token mas recusar quando a empresa está inativa", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(storedToken);
      userServiceMock.findActiveById.mockResolvedValue(user);
      companyServiceMock.isActive.mockResolvedValue(false);

      await expect(
        authService.refresh({ refreshToken: rawToken }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prismaMock.refreshToken.update).toHaveBeenCalled();
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe("logout", () => {
    it("deve revogar o refresh token informado", async () => {
      const rawToken = "raw-refresh-token";
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await authService.logout({ refreshToken: rawToken });

      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: hash(rawToken), revokedAt: null },
        data: { revokedAt: anyDate },
      });
    });
  });
});
