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
    findProfile: vi.fn(),
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
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    configServiceMock.get.mockReturnValue("7d");
    prismaMock.refreshToken.create.mockResolvedValue({});

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

  describe("me", () => {
    const profile = {
      id: "user-1",
      name: "Ana",
      email: "ana@orari.local",
      type: "ADMIN",
      people: null as {
        id: string;
        name: string;
        deletedAt: Date | null;
      } | null,
      company: {
        id: "company-1",
        corporateReason: "Clínica Bem Estar LTDA",
        fantasyName: "Bem Estar",
        timezone: "America/Sao_Paulo",
        logoUrl: null,
      },
    };

    it("deve devolver o usuário com a empresa pelo nome fantasia", async () => {
      userServiceMock.findProfile.mockResolvedValue(profile);

      await expect(authService.me("user-1")).resolves.toEqual({
        id: "user-1",
        name: "Ana",
        email: "ana@orari.local",
        type: "ADMIN",
        professional: null,
        person: null,
        company: {
          id: "company-1",
          name: "Bem Estar",
          timezone: "America/Sao_Paulo",
          logoUrl: null,
        },
      });
      expect(userServiceMock.findProfile).toHaveBeenCalledWith("user-1");
    });

    it("deve usar a razão social quando não há nome fantasia", async () => {
      userServiceMock.findProfile.mockResolvedValue({
        ...profile,
        company: { ...profile.company, fantasyName: null },
      });

      const result = await authService.me("user-1");

      expect(result.company.name).toBe("Clínica Bem Estar LTDA");
    });

    it("deve informar o profissional vinculado ativo", async () => {
      userServiceMock.findProfile.mockResolvedValue({
        ...profile,
        people: {
          id: "people-1",
          name: "Dra. Paula",
          type: "PROFESSIONAL",
          profession: "Esteticista",
          deletedAt: null,
        },
      });

      const result = await authService.me("user-1");

      expect(result.professional).toEqual({
        id: "people-1",
        name: "Dra. Paula",
      });
      expect(result.person).toEqual({
        id: "people-1",
        name: "Dra. Paula",
        type: "PROFESSIONAL",
        profession: "Esteticista",
      });
    });

    it("funcionário vinculado aparece em person, mas não em professional", async () => {
      userServiceMock.findProfile.mockResolvedValue({
        ...profile,
        people: {
          id: "people-2",
          name: "Paula Recepção",
          type: "EMPLOYEE",
          profession: "Recepcionista",
          deletedAt: null,
        },
      });

      const result = await authService.me("user-1");

      expect(result.professional).toBeNull();
      expect(result.person).toEqual({
        id: "people-2",
        name: "Paula Recepção",
        type: "EMPLOYEE",
        profession: "Recepcionista",
      });
    });

    it("não deve informar o profissional vinculado inativo", async () => {
      userServiceMock.findProfile.mockResolvedValue({
        ...profile,
        people: {
          id: "people-1",
          name: "Dra. Paula",
          type: "PROFESSIONAL",
          profession: null,
          deletedAt: new Date(),
        },
      });

      const result = await authService.me("user-1");

      expect(result.professional).toBeNull();
      expect(result.person).toBeNull();
    });

    it("deve recusar com 401 quando o usuário não existe mais", async () => {
      userServiceMock.findProfile.mockResolvedValue(null);

      await expect(authService.me("user-1")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
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
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(authService.login(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      // Compara mesmo sem usuário, para o tempo de resposta não revelar o e-mail.
      expect(bcrypt.compare).toHaveBeenCalledWith(
        dto.password,
        expect.stringMatching(/^\$2b\$10\$/),
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
    // Revogação condicionada: só um token ainda válido é encontrado.
    const revokeWhere = {
      where: {
        tokenHash: hash(rawToken),
        revokedAt: null,
        expiresAt: { gt: anyDate },
      },
      data: { revokedAt: anyDate },
    };

    beforeEach(() => {
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.refreshToken.findUniqueOrThrow.mockResolvedValue({
        userId: user.id,
      });
    });

    it("deve rotacionar o refresh token e emitir um novo par quando válido", async () => {
      userServiceMock.findActiveById.mockResolvedValue(user);
      companyServiceMock.isActive.mockResolvedValue(true);
      jwtServiceMock.signAsync.mockResolvedValue("new-access-token");

      const result = await authService.refresh({ refreshToken: rawToken });

      // O token usado é revogado antes de qualquer outra checagem (rotação).
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith(
        revokeWhere,
      );
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

    // Inexistente, já revogado, expirado ou usado ao mesmo tempo por outra
    // requisição: em todos os casos a revogação condicionada não encontra nada.
    it("deve lançar UnauthorizedException quando o token não está mais válido", async () => {
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        authService.refresh({ refreshToken: rawToken }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prismaMock.refreshToken.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it("deve aceitar só a primeira de duas renovações simultâneas com o mesmo token", async () => {
      // O banco aplica a segunda revogação depois da primeira e não acha mais o token válido.
      prismaMock.refreshToken.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      userServiceMock.findActiveById.mockResolvedValue(user);
      companyServiceMock.isActive.mockResolvedValue(true);
      jwtServiceMock.signAsync.mockResolvedValue("new-access-token");

      const results = await Promise.allSettled([
        authService.refresh({ refreshToken: rawToken }),
        authService.refresh({ refreshToken: rawToken }),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        "fulfilled",
        "rejected",
      ]);
      expect(prismaMock.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it("deve revogar o token mas recusar quando o usuário não está mais ativo", async () => {
      userServiceMock.findActiveById.mockResolvedValue(null);

      await expect(
        authService.refresh({ refreshToken: rawToken }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalled();
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it("deve revogar o token mas recusar quando a empresa está inativa", async () => {
      userServiceMock.findActiveById.mockResolvedValue(user);
      companyServiceMock.isActive.mockResolvedValue(false);

      await expect(
        authService.refresh({ refreshToken: rawToken }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalled();
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
