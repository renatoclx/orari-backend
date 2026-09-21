import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import * as bcrypt from "bcrypt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminUser,
  COMPANY_ID,
  OTHER_COMPANY_ID,
  superAdminUser,
} from "../../../test/fixtures/authenticated-users";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UserService } from "./user.service";

vi.mock("bcrypt", () => ({
  hash: vi.fn(),
}));

const anyDate: unknown = expect.any(Date);
const omit = { password: true };

// Filtros esperados de "usuários visíveis" para cada tipo (ver UserService.visibleTo).
const visibleToAdmin = {
  deletedAt: null,
  companyId: COMPANY_ID,
  type: { not: "SUPER_ADMIN" },
};
const visibleToSuperAdmin = (companyId?: string) => ({
  deletedAt: null,
  companyId,
  company: { isActive: true },
});

describe("UserService", () => {
  let userService: UserService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    user: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };
  const companyServiceMock = { findActive: vi.fn() };

  const dto: CreateUserDto = {
    name: "Maria",
    email: "maria@orari.com",
    password: "senha-forte",
    passwordConfirmation: "senha-forte",
    type: "USER",
  };
  const storedUser = {
    id: "user-2",
    name: dto.name,
    email: dto.email,
    type: "USER",
    companyId: COMPANY_ID,
  };
  const resetDto = {
    newPassword: "nova-senha",
    newPasswordConfirmation: "nova-senha",
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(bcrypt.hash).mockResolvedValue("hashed" as never);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CompanyService, useValue: companyServiceMock },
      ],
    }).compile();

    userService = module.get<UserService>(UserService);
  });

  describe("consultas da autenticação", () => {
    it("findByEmailWithPassword considera apenas usuários não excluídos", async () => {
      await userService.findByEmailWithPassword("maria@orari.com");

      expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
        where: { email: "maria@orari.com", deletedAt: null },
      });
    });

    it("findActiveById busca o usuário não excluído sem a senha", async () => {
      await userService.findActiveById("user-2");

      expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
        where: { id: "user-2", deletedAt: null },
        omit,
      });
    });
  });

  describe("create", () => {
    it("ADMIN cria na própria empresa, com hash da senha e sem a confirmação", async () => {
      prismaMock.user.create.mockResolvedValue(storedUser);

      await userService.create(dto, adminUser);

      expect(companyServiceMock.findActive).not.toHaveBeenCalled();
      expect(bcrypt.hash).toHaveBeenCalledWith("senha-forte", 10);
      expect(prismaMock.user.create).toHaveBeenCalledWith({
        data: {
          name: dto.name,
          email: dto.email,
          password: "hashed",
          type: "USER",
          companyId: COMPANY_ID,
        },
        omit,
      });
    });

    it("ADMIN não pode criar em outra empresa", async () => {
      await expect(
        userService.create({ ...dto, companyId: OTHER_COMPANY_ID }, adminUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it("ADMIN não pode criar SUPER_ADMIN", async () => {
      await expect(
        userService.create({ ...dto, type: "SUPER_ADMIN" }, adminUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("SUPER_ADMIN cria na empresa informada, que precisa estar ativa", async () => {
      await userService.create(
        { ...dto, type: "ADMIN", companyId: OTHER_COMPANY_ID },
        superAdminUser,
      );

      expect(companyServiceMock.findActive).toHaveBeenCalledWith(
        OTHER_COMPANY_ID,
      );
      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: OTHER_COMPANY_ID,
            type: "ADMIN",
          }) as unknown,
        }),
      );
    });

    it("SUPER_ADMIN precisa informar a empresa", async () => {
      await expect(
        userService.create(dto, superAdminUser),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("SUPER_ADMIN não cria usuário em empresa inativa", async () => {
      companyServiceMock.findActive.mockRejectedValueOnce(
        new NotFoundException(),
      );

      await expect(
        userService.create(
          { ...dto, companyId: OTHER_COMPANY_ID },
          superAdminUser,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it("deve lançar ConflictException quando o e-mail já existe", async () => {
      prismaMock.user.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(userService.create(dto, adminUser)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe("findAll", () => {
    beforeEach(() => {
      prismaMock.user.findMany.mockResolvedValue([storedUser]);
      prismaMock.user.count.mockResolvedValue(1);
    });

    it("ADMIN lista só a própria empresa, sem SUPER_ADMINs e sem senha", async () => {
      const result = await userService.findAll(
        { page: 1, limit: 10 },
        adminUser,
      );

      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: visibleToAdmin, omit }),
      );
      expect(result).toEqual({
        items: [storedUser],
        total: 1,
        page: 1,
        limit: 10,
      });
    });

    it("ADMIN não pode filtrar por outra empresa", async () => {
      await expect(
        userService.findAll(
          { page: 1, limit: 10, companyId: OTHER_COMPANY_ID },
          adminUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("SUPER_ADMIN lista usuários de empresas ativas, com filtro opcional", async () => {
      await userService.findAll({ page: 1, limit: 10 }, superAdminUser);
      await userService.findAll(
        { page: 1, limit: 10, companyId: OTHER_COMPANY_ID },
        superAdminUser,
      );

      expect(prismaMock.user.count).toHaveBeenNthCalledWith(1, {
        where: visibleToSuperAdmin(undefined),
      });
      expect(prismaMock.user.count).toHaveBeenNthCalledWith(2, {
        where: visibleToSuperAdmin(OTHER_COMPANY_ID),
      });
    });
  });

  describe("findOne", () => {
    it("aplica o filtro de visibilidade de quem consulta", async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);

      await expect(
        userService.findOne("user-2", adminUser),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
        where: { id: "user-2", ...visibleToAdmin },
        omit,
      });
    });
  });

  describe("update", () => {
    it("deve atualizar sem expor a senha e registrando o updatedAt", async () => {
      prismaMock.user.findFirst.mockResolvedValue(storedUser);

      await userService.update("user-2", { type: "ADMIN" }, adminUser);

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-2" },
        data: { type: "ADMIN", updatedAt: anyDate },
        omit,
      });
    });

    it("não deve permitir alterar o próprio tipo", async () => {
      prismaMock.user.findFirst.mockResolvedValue({
        ...storedUser,
        id: adminUser.id,
        type: "ADMIN",
      });

      await expect(
        userService.update(adminUser.id, { type: "USER" }, adminUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("deve permitir editar os próprios dados sem mudar o tipo", async () => {
      prismaMock.user.findFirst.mockResolvedValue({
        ...storedUser,
        id: adminUser.id,
        type: "ADMIN",
      });

      await userService.update(
        adminUser.id,
        { name: "Novo nome", type: "ADMIN" },
        adminUser,
      );

      expect(prismaMock.user.update).toHaveBeenCalled();
    });

    it("ADMIN não pode promover alguém a SUPER_ADMIN", async () => {
      prismaMock.user.findFirst.mockResolvedValue(storedUser);

      await expect(
        userService.update("user-2", { type: "SUPER_ADMIN" }, adminUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("SUPER_ADMIN pode promover alguém a SUPER_ADMIN", async () => {
      prismaMock.user.findFirst.mockResolvedValue(storedUser);

      await userService.update(
        "user-2",
        { type: "SUPER_ADMIN" },
        superAdminUser,
      );

      expect(prismaMock.user.update).toHaveBeenCalled();
    });
  });

  describe("resetPassword", () => {
    it("deve gravar o hash da nova senha sem expô-la", async () => {
      prismaMock.user.findFirst.mockResolvedValue(storedUser);

      await userService.resetPassword("user-2", resetDto, adminUser);

      expect(bcrypt.hash).toHaveBeenCalledWith("nova-senha", 10);
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-2" },
        data: { password: "hashed", updatedAt: anyDate },
        omit,
      });
    });

    it("não deve redefinir a senha de usuário fora do alcance", async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);

      await expect(
        userService.resetPassword("user-2", resetDto, adminUser),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("deve excluir logicamente o usuário", async () => {
      prismaMock.user.findFirst.mockResolvedValue(storedUser);

      await userService.remove("user-2", adminUser);

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-2" },
        data: { deletedAt: anyDate, updatedAt: anyDate },
      });
    });

    it.each([adminUser, superAdminUser])(
      "$type não pode excluir a própria conta",
      async (currentUser) => {
        await expect(
          userService.remove(currentUser.id, currentUser),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
        expect(prismaMock.user.update).not.toHaveBeenCalled();
      },
    );
  });
});
