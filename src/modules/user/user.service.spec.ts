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
import { PlanLimitService } from "../company-access/plan-limit.service";
import { CompanyService } from "../company/company.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UserService } from "./user.service";

vi.mock("bcrypt", () => ({
  hash: vi.fn(),
  compare: vi.fn(),
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
    people: { findFirst: vi.fn(), updateMany: vi.fn() },
  };
  const auditServiceMock = { record: vi.fn() };
  const planLimitMock = { assertWithinLimit: vi.fn() };
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
        { provide: PlanLimitService, useValue: planLimitMock },
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
          phone: true,
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

    describe("usuário PROFESSIONAL (só app)", () => {
      const peopleId = "11111111-1111-4111-8111-111111111111";
      const proDto = {
        ...dto,
        type: "PROFESSIONAL" as const,
        peopleId,
        phone: "(11) 98888-0001",
      };

      it("exige o vínculo", async () => {
        await expect(
          userService.create(
            { ...dto, type: "PROFESSIONAL", phone: "11988880001" },
            adminUser,
          ),
        ).rejects.toThrow("vinculado a um profissional ativo");
        expect(prismaMock.user.create).not.toHaveBeenCalled();
      });

      it("recusa funcionário: só o profissional ativo da empresa vale", async () => {
        // O vínculo comum aceita funcionário (1ª consulta); a do app não (2ª).
        prismaMock.people.findFirst
          .mockResolvedValueOnce({ id: peopleId })
          .mockResolvedValueOnce(null);
        prismaMock.user.findFirst.mockResolvedValue(null);

        await expect(
          userService.create(proDto, adminUser),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prismaMock.people.findFirst).toHaveBeenLastCalledWith({
          where: {
            id: peopleId,
            companyId: COMPANY_ID,
            type: "PROFESSIONAL",
            deletedAt: null,
          },
          select: { id: true },
        });
        expect(prismaMock.user.create).not.toHaveBeenCalled();
      });

      it("exige o telefone de login e confere o formato", async () => {
        prismaMock.people.findFirst.mockResolvedValue({ id: peopleId });
        prismaMock.user.findFirst.mockResolvedValue(null);

        await expect(
          userService.create({ ...proDto, phone: undefined }, adminUser),
        ).rejects.toThrow("precisa do telefone");
        await expect(
          userService.create({ ...proDto, phone: "123" }, adminUser),
        ).rejects.toThrow("10 ou 11 dígitos");
        expect(prismaMock.user.create).not.toHaveBeenCalled();
      });

      it("aceita o +55 e a máscara, gravando só os dígitos", async () => {
        prismaMock.people.findFirst.mockResolvedValue({ id: peopleId });
        prismaMock.user.findFirst.mockResolvedValue(null);
        prismaMock.user.create.mockResolvedValue(storedUser);

        await userService.create(
          { ...proDto, phone: "+55 (11) 98888-0001" },
          adminUser,
        );

        expect(prismaMock.user.create).toHaveBeenCalledWith(
          containing({ data: containing({ phone: "11988880001" }) }),
        );
      });

      it("telefone já usado por outro usuário ativo responde 409, sem gravar", async () => {
        prismaMock.people.findFirst.mockResolvedValue({ id: peopleId });
        prismaMock.user.findFirst.mockResolvedValue(null);
        prismaMock.user.count.mockResolvedValueOnce(1);

        await expect(userService.create(proDto, adminUser)).rejects.toThrow(
          "Já existe um usuário profissional com este telefone",
        );
        expect(prismaMock.user.count).toHaveBeenCalledWith({
          where: { phone: "11988880001", deletedAt: null },
        });
        expect(prismaMock.user.create).not.toHaveBeenCalled();
      });

      it("os demais tipos não têm telefone de acesso (400 se enviado)", async () => {
        await expect(
          userService.create({ ...dto, phone: "11988880001" }, adminUser),
        ).rejects.toThrow("só do usuário profissional");
      });

      it("cria vinculado ao profissional, sem ocupar vaga de administrador", async () => {
        prismaMock.people.findFirst.mockResolvedValue({ id: peopleId });
        prismaMock.user.findFirst.mockResolvedValue(null);
        prismaMock.user.create.mockResolvedValue({
          ...storedUser,
          type: "PROFESSIONAL",
          peopleId,
        });

        await userService.create(proDto, adminUser);

        expect(planLimitMock.assertWithinLimit).not.toHaveBeenCalled();
        // O telefone é gravado só com os dígitos (é o login dele no app).
        expect(prismaMock.user.create).toHaveBeenCalledWith(
          containing({
            data: containing({
              type: "PROFESSIONAL",
              peopleId,
              phone: "11988880001",
            }),
          }),
        );
        // O profissional segue com a comissão como está (não é o dono que atende).
        expect(prismaMock.people.updateMany).not.toHaveBeenCalled();
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

      it("ADMIN vinculado a um profissional: ele nasce sem comissão", async () => {
        prismaMock.people.findFirst.mockResolvedValue({ id: peopleId });
        prismaMock.user.findFirst.mockResolvedValue(null);
        prismaMock.user.create.mockResolvedValue({
          ...storedUser,
          type: "ADMIN",
          peopleId,
        });

        await userService.create({ ...linkedDto, type: "ADMIN" }, adminUser);

        expect(prismaMock.people.updateMany).toHaveBeenCalledWith({
          where: { id: peopleId, type: "PROFESSIONAL" },
          data: { receivesCommission: false, commissionSince: null },
        });
      });

      it("usuário comum vinculado: a comissão do profissional não muda", async () => {
        prismaMock.people.findFirst.mockResolvedValue({ id: peopleId });
        prismaMock.user.findFirst.mockResolvedValue(null);
        prismaMock.user.create.mockResolvedValue({ ...storedUser, peopleId });

        await userService.create(linkedDto, adminUser);

        expect(prismaMock.people.updateMany).not.toHaveBeenCalled();
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

    describe("usuário PROFESSIONAL (só app)", () => {
      const peopleId = "11111111-1111-4111-8111-111111111111";
      const professional = {
        ...storedUser,
        type: "PROFESSIONAL",
        peopleId,
        phone: "11988880001",
      };

      it("não perde o vínculo enquanto for só de app", async () => {
        prismaMock.user.findFirst.mockResolvedValue(professional);

        await expect(
          userService.update("user-2", { peopleId: null }, adminUser),
        ).rejects.toThrow("vinculado a um profissional ativo");
        expect(prismaMock.user.update).not.toHaveBeenCalled();
      });

      it("virar só de app sem profissional vinculado é recusado", async () => {
        prismaMock.user.findFirst.mockResolvedValue({
          ...storedUser,
          peopleId: null,
        });

        await expect(
          userService.update("user-2", { type: "PROFESSIONAL" }, adminUser),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it("virar só de app com um profissional ativo vinculado funciona", async () => {
        prismaMock.user.findFirst.mockResolvedValue({
          ...storedUser,
          peopleId,
        });
        prismaMock.people.findFirst.mockResolvedValue({ id: peopleId });
        // O beforeEach do bloco deixa count=1 (limite de admins); aqui o telefone está livre.
        prismaMock.user.count.mockResolvedValue(0);
        prismaMock.user.update.mockResolvedValue(professional);

        await userService.update(
          "user-2",
          { type: "PROFESSIONAL", phone: "(11) 98888-0001" },
          adminUser,
        );

        expect(prismaMock.user.update).toHaveBeenCalledWith(
          containing({ data: containing({ phone: "11988880001" }) }),
        );
      });

      it("trocar o telefone confere os outros usuários, menos ele mesmo", async () => {
        prismaMock.user.findFirst.mockResolvedValue(professional);
        prismaMock.user.count.mockResolvedValueOnce(1);

        await expect(
          userService.update("user-2", { phone: "11977770002" }, adminUser),
        ).rejects.toThrow(
          "Já existe um usuário profissional com este telefone",
        );
        expect(prismaMock.user.count).toHaveBeenCalledWith({
          where: {
            phone: "11977770002",
            deletedAt: null,
            id: { not: "user-2" },
          },
        });
      });

      it("sair do tipo só de app apaga o telefone", async () => {
        prismaMock.user.findFirst.mockResolvedValue(professional);
        prismaMock.user.update.mockResolvedValue({
          ...professional,
          type: "USER",
          phone: null,
        });

        await userService.update("user-2", { type: "USER" }, adminUser);

        expect(prismaMock.user.update).toHaveBeenCalledWith(
          containing({ data: containing({ type: "USER", phone: null }) }),
        );
      });

      it("não deixa tirar o telefone enquanto for só de app (400)", async () => {
        prismaMock.user.findFirst.mockResolvedValue(professional);
        prismaMock.people.findFirst.mockResolvedValue({ id: peopleId });

        await expect(
          userService.update("user-2", { phone: null }, adminUser),
        ).rejects.toThrow("precisa do telefone");
      });

      it("trocar outros dados não confere o vínculo de novo", async () => {
        prismaMock.user.findFirst.mockResolvedValue(professional);
        prismaMock.user.update.mockResolvedValue(professional);

        await userService.update("user-2", { name: "Novo nome" }, adminUser);

        expect(prismaMock.people.findFirst).not.toHaveBeenCalled();
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

  describe("findProfessionalByPhoneWithPassword", () => {
    it("só o usuário PROFESSIONAL ativo, pelo telefone", async () => {
      await userService.findProfessionalByPhoneWithPassword("11988880001");

      expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
        where: {
          phone: "11988880001",
          type: "PROFESSIONAL",
          deletedAt: null,
        },
      });
    });
  });

  describe("changeOwnPassword", () => {
    it("confere a senha atual, grava o hash e encerra as sessões", async () => {
      prismaMock.user.findFirst.mockResolvedValue({ password: "hash-atual" });
      vi.mocked(bcrypt.compare)
        .mockResolvedValueOnce(true as never) // a atual confere
        .mockResolvedValueOnce(false as never); // a nova é outra

      await userService.changeOwnPassword("user-2", "atual", "nova-senha");

      expect(bcrypt.hash).toHaveBeenCalledWith("nova-senha", 10);
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-2" },
        data: { password: "hashed", updatedAt: anyDate },
      });
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith(
        revokeSessionsOf("user-2"),
      );
    });

    it("recusa a senha atual errada (400) sem gravar", async () => {
      prismaMock.user.findFirst.mockResolvedValue({ password: "hash-atual" });
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(
        userService.changeOwnPassword("user-2", "errada", "nova-senha"),
      ).rejects.toThrow("A senha atual está incorreta");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("recusa a nova senha igual à atual (400)", async () => {
      prismaMock.user.findFirst.mockResolvedValue({ password: "hash-atual" });
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      await expect(
        userService.changeOwnPassword("user-2", "atual", "atual"),
      ).rejects.toThrow("diferente da atual");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("usuário inexistente ou excluído responde como senha incorreta", async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);

      await expect(
        userService.changeOwnPassword("user-x", "atual", "nova-senha"),
      ).rejects.toBeInstanceOf(BadRequestException);
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
        select: {
          deletedAt: true,
          type: true,
          peopleId: true,
          companyId: true,
        },
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

  describe("limite de administradores do plano", () => {
    it("criar ADMIN confere o limite da empresa na mesma transação", async () => {
      prismaMock.user.create.mockResolvedValue({
        ...storedUser,
        type: "ADMIN",
      });

      await userService.create({ ...dto, type: "ADMIN" }, adminUser);

      expect(planLimitMock.assertWithinLimit).toHaveBeenCalledWith(
        "admins",
        COMPANY_ID,
        prismaMock,
      );
    });

    it("limite atingido: o usuário não é criado", async () => {
      planLimitMock.assertWithinLimit.mockRejectedValueOnce(
        new Error("limite"),
      );

      await expect(
        userService.create({ ...dto, type: "ADMIN" }, adminUser),
      ).rejects.toThrow("limite");
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it("criar usuário comum não confere o limite", async () => {
      prismaMock.user.create.mockResolvedValue(storedUser);

      await userService.create(dto, adminUser);

      expect(planLimitMock.assertWithinLimit).not.toHaveBeenCalled();
    });

    it("promover a ADMIN confere o limite; mudar para outro tipo, não", async () => {
      prismaMock.user.findFirst.mockResolvedValue(storedUser);
      prismaMock.user.update.mockResolvedValue({
        ...storedUser,
        type: "ADMIN",
      });

      await userService.update("user-2", { type: "ADMIN" }, adminUser);
      expect(planLimitMock.assertWithinLimit).toHaveBeenCalledWith(
        "admins",
        COMPANY_ID,
        prismaMock,
      );

      planLimitMock.assertWithinLimit.mockClear();
      await userService.update("user-2", { name: "Maria Silva" }, adminUser);
      expect(planLimitMock.assertWithinLimit).not.toHaveBeenCalled();
    });

    it("reativar ADMIN confere o limite; reativar usuário comum, não", async () => {
      prismaMock.user.update.mockResolvedValue(storedUser);

      prismaMock.user.findFirst.mockResolvedValue({
        deletedAt: new Date(),
        type: "ADMIN",
        peopleId: null,
        companyId: COMPANY_ID,
      });
      await userService.restore("user-2", adminUser);
      expect(planLimitMock.assertWithinLimit).toHaveBeenCalledTimes(1);

      prismaMock.user.findFirst.mockResolvedValue({
        deletedAt: new Date(),
        type: "USER",
        peopleId: null,
        companyId: COMPANY_ID,
      });
      await userService.restore("user-2", adminUser);
      expect(planLimitMock.assertWithinLimit).toHaveBeenCalledTimes(1);
    });
  });
});
