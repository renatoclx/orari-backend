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
import { AuditService } from "../audit/audit.service";
import { CompanyService } from "../company/company.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UserService } from "./user.service";

vi.mock("bcrypt", () => ({
  hash: vi.fn(),
}));

const anyDate: unknown = expect.any(Date);
const containing = (expected: object): unknown =>
  expect.objectContaining(expected);
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

// A listagem e a reativação também enxergam os inativos (sem o filtro de deletedAt).
const withDeleted = (filter: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(filter).filter(([key]) => key !== "deletedAt"),
  );

describe("UserService", () => {
  let userService: UserService;
  const prismaMock = {
    // Aceita as duas formas: lista de operações e função com o cliente da transação.
    $transaction: vi.fn(
      (operations: Promise<unknown>[] | ((tx: unknown) => unknown)) =>
        typeof operations === "function"
          ? operations(prismaMock)
          : Promise.all(operations),
    ),
    user: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    refreshToken: { updateMany: vi.fn() },
    people: { findFirst: vi.fn() },
  };
  const auditServiceMock = { record: vi.fn() };
  // Revogação de todas as sessões do usuário-alvo.
  const revokeSessionsOf = (userId: string) => ({
    where: { userId, revokedAt: null },
    data: { revokedAt: anyDate },
  });
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
        { provide: AuditService, useValue: auditServiceMock },
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

    it("findProfile busca o usuário não excluído com a empresa, sem a senha", async () => {
      await userService.findProfile("user-2");

      expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
        where: { id: "user-2", deletedAt: null },
        select: {
          id: true,
          name: true,
          email: true,
          type: true,
          people: {
            select: {
              id: true,
              name: true,
              type: true,
              profession: true,
              deletedAt: true,
            },
          },
          company: {
            select: {
              id: true,
              corporateReason: true,
              fantasyName: true,
              timezone: true,
              logoUrl: true,
            },
          },
        },
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

    describe("vínculo com o profissional ou funcionário", () => {
      const peopleId = "11111111-1111-4111-8111-111111111111";
      const linkedDto = { ...dto, peopleId };

      it("cria vinculado ao profissional e audita na mesma transação", async () => {
        prismaMock.people.findFirst.mockResolvedValue({ id: peopleId });
        prismaMock.user.findFirst.mockResolvedValue(null);
        prismaMock.user.create.mockResolvedValue({ ...storedUser, peopleId });

        await userService.create(linkedDto, adminUser, "10.0.0.1");

        // Só profissional ou funcionário ativo da empresa do usuário é aceito.
        expect(prismaMock.people.findFirst).toHaveBeenCalledWith({
          where: {
            id: peopleId,
            companyId: COMPANY_ID,
            type: { in: ["PROFESSIONAL", "EMPLOYEE"] },
            deletedAt: null,
          },
          select: { id: true },
        });
        expect(auditServiceMock.record).toHaveBeenCalledWith(
          {
            companyId: COMPANY_ID,
            userId: adminUser.id,
            action: "USER_LINK_CHANGED",
            entityType: "USER",
            entityId: storedUser.id,
            ip: "10.0.0.1",
          },
          prismaMock,
        );
      });

      it("recusa pessoa que não é profissional ou funcionário ativo da empresa (400)", async () => {
        prismaMock.people.findFirst.mockResolvedValue(null);

        await expect(
          userService.create(linkedDto, adminUser),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prismaMock.user.create).not.toHaveBeenCalled();
      });

      it("recusa profissional já vinculado a outro usuário ativo (409)", async () => {
        prismaMock.people.findFirst.mockResolvedValue({ id: peopleId });
        prismaMock.user.findFirst.mockResolvedValue({ id: "user-9" });

        await expect(
          userService.create(linkedDto, adminUser),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prismaMock.user.create).not.toHaveBeenCalled();
      });

      it("sem vínculo, não consulta profissional nem audita", async () => {
        prismaMock.user.create.mockResolvedValue(storedUser);

        await userService.create(dto, adminUser);

        expect(prismaMock.people.findFirst).not.toHaveBeenCalled();
        expect(auditServiceMock.record).not.toHaveBeenCalled();
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
      prismaMock.user.create.mockResolvedValue({
        ...storedUser,
        type: "ADMIN",
        companyId: OTHER_COMPANY_ID,
      });

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
      // Nascer ADMIN dá acesso à anamnese: fica registrado na empresa do usuário.
      expect(auditServiceMock.record).toHaveBeenCalledWith(
        {
          companyId: OTHER_COMPANY_ID,
          userId: superAdminUser.id,
          action: "USER_TYPE_CHANGED",
          entityType: "USER",
          entityId: storedUser.id,
          ip: undefined,
        },
        prismaMock,
      );
    });

    it("ADMIN que cria outro ADMIN audita na mesma transação", async () => {
      prismaMock.user.create.mockResolvedValue({
        ...storedUser,
        type: "ADMIN",
      });

      await userService.create(
        { ...dto, type: "ADMIN" },
        adminUser,
        "10.0.0.1",
      );

      expect(auditServiceMock.record).toHaveBeenCalledTimes(1);
      expect(auditServiceMock.record).toHaveBeenCalledWith(
        containing({ action: "USER_TYPE_CHANGED", ip: "10.0.0.1" }),
        prismaMock,
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

    it("ADMIN lista só a própria empresa (ativos e inativos), sem SUPER_ADMINs e sem senha", async () => {
      const result = await userService.findAll(
        { page: 1, limit: 10 },
        adminUser,
      );

      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: withDeleted(visibleToAdmin), omit }),
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

    it("filtra pelo nome (parcial, sem diferenciar maiúsculas) dentro do que o usuário enxerga", async () => {
      await userService.findAll(
        { page: 1, limit: 10, name: " mar " },
        adminUser,
      );

      expect(prismaMock.user.count).toHaveBeenCalledWith({
        where: {
          ...withDeleted(visibleToAdmin),
          name: { contains: "mar", mode: "insensitive" },
        },
      });
    });

    it("SUPER_ADMIN lista usuários de empresas ativas, com filtro opcional", async () => {
      await userService.findAll({ page: 1, limit: 10 }, superAdminUser);
      await userService.findAll(
        { page: 1, limit: 10, companyId: OTHER_COMPANY_ID },
        superAdminUser,
      );

      expect(prismaMock.user.count).toHaveBeenNthCalledWith(1, {
        where: withDeleted(visibleToSuperAdmin(undefined)),
      });
      expect(prismaMock.user.count).toHaveBeenNthCalledWith(2, {
        where: withDeleted(visibleToSuperAdmin(OTHER_COMPANY_ID)),
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
      prismaMock.user.update.mockResolvedValue({
        ...storedUser,
        type: "ADMIN",
      });

      await userService.update("user-2", { type: "ADMIN" }, adminUser);

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-2" },
        data: { type: "ADMIN", updatedAt: anyDate },
        omit,
      });
    });

    describe("auditoria da mudança de tipo", () => {
      it.each([
        ["promove a ADMIN", "USER", "ADMIN"],
        ["tira do ADMIN", "ADMIN", "USER"],
      ])("%s e audita na mesma transação", async (_, from, to) => {
        prismaMock.user.findFirst.mockResolvedValue({
          ...storedUser,
          type: from,
        });
        prismaMock.user.update.mockResolvedValue({ ...storedUser, type: to });

        await userService.update(
          "user-2",
          { type: to as "USER" | "ADMIN" },
          adminUser,
          "10.0.0.1",
        );

        expect(auditServiceMock.record).toHaveBeenCalledWith(
          {
            companyId: COMPANY_ID,
            userId: adminUser.id,
            action: "USER_TYPE_CHANGED",
            entityType: "USER",
            entityId: storedUser.id,
            ip: "10.0.0.1",
          },
          prismaMock,
        );
      });

      it("reenviar o mesmo tipo ou alterar só o nome não audita", async () => {
        prismaMock.user.findFirst.mockResolvedValue(storedUser);
        prismaMock.user.update.mockResolvedValue(storedUser);

        await userService.update("user-2", { type: "USER" }, adminUser);
        await userService.update("user-2", { name: "Outro" }, adminUser);

        expect(auditServiceMock.record).not.toHaveBeenCalled();
      });

      it("não altera o tipo se a auditoria falhar", async () => {
        prismaMock.user.findFirst.mockResolvedValue(storedUser);
        prismaMock.user.update.mockResolvedValue({
          ...storedUser,
          type: "ADMIN",
        });
        auditServiceMock.record.mockRejectedValueOnce(new Error("db fora"));

        await expect(
          userService.update("user-2", { type: "ADMIN" }, adminUser),
        ).rejects.toThrow("db fora");
      });
    });

    describe("vínculo com o profissional", () => {
      const peopleId = "11111111-1111-4111-8111-111111111111";

      it("troca o vínculo, confere o profissional (ignorando o próprio usuário) e audita", async () => {
        prismaMock.user.findFirst
          .mockResolvedValueOnce({ ...storedUser, peopleId: null })
          .mockResolvedValueOnce(null);
        prismaMock.people.findFirst.mockResolvedValue({ id: peopleId });
        prismaMock.user.update.mockResolvedValue({ ...storedUser, peopleId });

        await userService.update("user-2", { peopleId }, adminUser, "10.0.0.1");

        expect(prismaMock.user.findFirst).toHaveBeenLastCalledWith({
          where: { peopleId, deletedAt: null, id: { not: "user-2" } },
          select: { id: true },
        });
        expect(auditServiceMock.record).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: adminUser.id,
            action: "USER_LINK_CHANGED",
            entityId: "user-2",
            ip: "10.0.0.1",
          }),
          prismaMock,
        );
      });

      it("null desfaz o vínculo, sem consultar profissional, e audita", async () => {
        prismaMock.user.findFirst.mockResolvedValue({
          ...storedUser,
          peopleId,
        });
        prismaMock.user.update.mockResolvedValue({
          ...storedUser,
          peopleId: null,
        });

        await userService.update("user-2", { peopleId: null }, adminUser);

        expect(prismaMock.people.findFirst).not.toHaveBeenCalled();
        expect(prismaMock.user.update).toHaveBeenCalledWith({
          where: { id: "user-2" },
          data: { peopleId: null, updatedAt: anyDate },
          omit,
        });
        expect(auditServiceMock.record).toHaveBeenCalledTimes(1);
      });

      it("reenviar o mesmo vínculo não valida de novo nem audita", async () => {
        prismaMock.user.findFirst.mockResolvedValue({
          ...storedUser,
          peopleId,
        });

        await userService.update("user-2", { peopleId }, adminUser);

        expect(prismaMock.people.findFirst).not.toHaveBeenCalled();
        expect(auditServiceMock.record).not.toHaveBeenCalled();
      });

      it("recusa profissional já vinculado a outro usuário ativo (409)", async () => {
        prismaMock.user.findFirst
          .mockResolvedValueOnce({ ...storedUser, peopleId: null })
          .mockResolvedValueOnce({ id: "user-9" });
        prismaMock.people.findFirst.mockResolvedValue({ id: peopleId });

        await expect(
          userService.update("user-2", { peopleId }, adminUser),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prismaMock.user.update).not.toHaveBeenCalled();
      });

      it("SUPER_ADMIN valida o profissional na empresa do usuário alterado", async () => {
        prismaMock.user.findFirst
          .mockResolvedValueOnce({
            ...storedUser,
            companyId: OTHER_COMPANY_ID,
            peopleId: null,
          })
          .mockResolvedValueOnce(null);
        prismaMock.people.findFirst.mockResolvedValue({ id: peopleId });
        prismaMock.user.update.mockResolvedValue({
          ...storedUser,
          companyId: OTHER_COMPANY_ID,
          peopleId,
        });

        await userService.update("user-2", { peopleId }, superAdminUser);

        expect(prismaMock.people.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: containing({ companyId: OTHER_COMPANY_ID }),
          }),
        );
        // A auditoria fica na empresa do usuário, para o ADMIN dela enxergar.
        expect(auditServiceMock.record).toHaveBeenCalledWith(
          expect.objectContaining({ companyId: OTHER_COMPANY_ID }),
          prismaMock,
        );
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

    it("deve encerrar as sessões do usuário na mesma transação", async () => {
      prismaMock.user.findFirst.mockResolvedValue(storedUser);

      await userService.resetPassword("user-2", resetDto, adminUser);

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith(
        revokeSessionsOf("user-2"),
      );
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

  describe("restore", () => {
    it("deve reativar o usuário inativado, sem expor a senha", async () => {
      prismaMock.user.findFirst.mockResolvedValue({ deletedAt: new Date() });
      prismaMock.user.update.mockResolvedValue(storedUser);

      await expect(userService.restore("user-2", adminUser)).resolves.toEqual(
        storedUser,
      );

      expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
        where: { id: "user-2", ...withDeleted(visibleToAdmin) },
        select: { deletedAt: true, type: true, peopleId: true },
      });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-2" },
        data: { deletedAt: null, updatedAt: anyDate },
        omit,
      });
      // Tokens de antes da inativação não voltam a valer.
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith(
        revokeSessionsOf("user-2"),
      );
      // Usuário comum sem vínculo não volta a ter acesso à anamnese.
      expect(auditServiceMock.record).not.toHaveBeenCalled();
    });

    it.each([
      ["ADMIN", { type: "ADMIN", peopleId: null }],
      ["vinculado a uma pessoa", { type: "USER", peopleId: "people-1" }],
    ])("reativar usuário %s audita na mesma transação", async (_, user) => {
      prismaMock.user.findFirst.mockResolvedValue({
        deletedAt: new Date(),
        ...user,
      });
      prismaMock.user.update.mockResolvedValue({ ...storedUser, ...user });

      await userService.restore("user-2", adminUser, "10.0.0.1");

      expect(auditServiceMock.record).toHaveBeenCalledWith(
        {
          companyId: COMPANY_ID,
          userId: adminUser.id,
          action: "USER_RESTORED",
          entityType: "USER",
          entityId: storedUser.id,
          ip: "10.0.0.1",
        },
        prismaMock,
      );
    });

    it("deve lançar NotFoundException para usuário fora do alcance", async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);

      await expect(
        userService.restore("user-2", adminUser),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("deve lançar ConflictException quando o usuário já está ativo", async () => {
      prismaMock.user.findFirst.mockResolvedValue({ deletedAt: null });

      await expect(
        userService.restore("user-2", adminUser),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("deve lançar ConflictException quando o e-mail já está em uso por outro ativo", async () => {
      prismaMock.user.findFirst.mockResolvedValue({ deletedAt: new Date() });
      prismaMock.user.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(
        userService.restore("user-2", adminUser),
      ).rejects.toBeInstanceOf(ConflictException);
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
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith(
        revokeSessionsOf("user-2"),
      );
    });

    it.each([adminUser, superAdminUser])(
      "$type não pode excluir a própria conta",
      async (currentUser) => {
        await expect(
          userService.remove(currentUser.id, currentUser),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
        expect(prismaMock.user.update).not.toHaveBeenCalled();
        expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
      },
    );
  });
});
