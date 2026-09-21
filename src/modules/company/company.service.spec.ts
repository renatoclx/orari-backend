import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  adminUser,
  COMPANY_ID,
  OTHER_COMPANY_ID,
  PLATFORM_COMPANY_ID,
  superAdminUser,
} from "../../../test/fixtures/authenticated-users";
import { CompanyService } from "./company.service";
import { CreateCompanyDto } from "./dto/create-company.dto";

const anyDate: unknown = expect.any(Date);

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });

describe("CompanyService", () => {
  let companyService: CompanyService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    company: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };

  const dto: CreateCompanyDto = {
    corporateReason: "Orari LTDA",
    cnpj: "11222333000181",
    foundationDate: new Date("2020-01-15"),
    subdomain: "orari",
  };
  const company = { id: COMPANY_ID, ...dto, isActive: true };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    companyService = module.get<CompanyService>(CompanyService);
  });

  describe("create", () => {
    it("deve criar a empresa", async () => {
      prismaMock.company.create.mockResolvedValue(company);

      await expect(companyService.create(dto)).resolves.toEqual(company);
      expect(prismaMock.company.create).toHaveBeenCalledWith({ data: dto });
    });

    it("deve lançar ConflictException quando CNPJ ou subdomínio já existem", async () => {
      prismaMock.company.create.mockRejectedValueOnce(uniqueViolation());

      await expect(companyService.create(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("deve propagar erros que não são de unicidade", async () => {
      const error = new Error("falha de conexão");
      prismaMock.company.create.mockRejectedValueOnce(error);

      await expect(companyService.create(dto)).rejects.toBe(error);
    });
  });

  describe("findAll", () => {
    beforeEach(() => {
      prismaMock.company.findMany.mockResolvedValue([company]);
      prismaMock.company.count.mockResolvedValue(1);
    });

    it("SUPER_ADMIN lista todas as empresas, com filtro opcional de status", async () => {
      await companyService.findAll(
        { page: 1, limit: 10, isActive: false },
        superAdminUser,
      );

      expect(prismaMock.company.count).toHaveBeenCalledWith({
        where: { id: undefined, isActive: false },
      });
    });

    it("demais tipos listam apenas a própria empresa", async () => {
      const result = await companyService.findAll(
        { page: 1, limit: 10 },
        adminUser,
      );

      expect(prismaMock.company.count).toHaveBeenCalledWith({
        where: { id: COMPANY_ID, isActive: undefined },
      });
      expect(result).toEqual({
        items: [company],
        total: 1,
        page: 1,
        limit: 10,
      });
    });

    it("demais tipos não podem filtrar por status", async () => {
      await expect(
        companyService.findAll(
          { page: 1, limit: 10, isActive: true },
          adminUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.company.findMany).not.toHaveBeenCalled();
    });
  });

  describe("findOne", () => {
    it("SUPER_ADMIN consulta qualquer empresa, inclusive inativa", async () => {
      prismaMock.company.findUnique.mockResolvedValue({
        ...company,
        id: OTHER_COMPANY_ID,
        isActive: false,
      });

      await expect(
        companyService.findOne(OTHER_COMPANY_ID, superAdminUser),
      ).resolves.toMatchObject({ isActive: false });
    });

    it("demais tipos recebem 404 para outra empresa, sem consultar o banco", async () => {
      await expect(
        companyService.findOne(OTHER_COMPANY_ID, adminUser),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.company.findUnique).not.toHaveBeenCalled();
    });

    it("demais tipos consultam a própria empresa", async () => {
      prismaMock.company.findUnique.mockResolvedValue(company);

      await expect(
        companyService.findOne(COMPANY_ID, adminUser),
      ).resolves.toEqual(company);
    });
  });

  describe("findActive", () => {
    it("deve lançar NotFoundException para empresa inexistente ou inativa", async () => {
      prismaMock.company.findFirst.mockResolvedValue(null);

      await expect(
        companyService.findActive(COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.company.findFirst).toHaveBeenCalledWith({
        where: { id: COMPANY_ID, isActive: true },
      });
    });
  });

  describe("isActive", () => {
    it("deve retornar o status da empresa", async () => {
      prismaMock.company.findUnique.mockResolvedValue({ isActive: false });

      await expect(companyService.isActive(COMPANY_ID)).resolves.toBe(false);
    });

    it("deve tratar empresa inexistente como inativa", async () => {
      prismaMock.company.findUnique.mockResolvedValue(null);

      await expect(companyService.isActive(COMPANY_ID)).resolves.toBe(false);
    });
  });

  describe("update", () => {
    it("deve atualizar a empresa registrando o updatedAt", async () => {
      prismaMock.company.findUnique.mockResolvedValue(company);
      prismaMock.company.update.mockResolvedValue(company);

      await companyService.update(
        COMPANY_ID,
        { isActive: false },
        superAdminUser,
      );

      expect(prismaMock.company.update).toHaveBeenCalledWith({
        where: { id: COMPANY_ID },
        data: { isActive: false, updatedAt: anyDate },
      });
    });

    it("não deve permitir inativar a própria empresa", async () => {
      await expect(
        companyService.update(
          PLATFORM_COMPANY_ID,
          { isActive: false },
          superAdminUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.company.update).not.toHaveBeenCalled();
    });

    it("deve permitir outras alterações na própria empresa", async () => {
      prismaMock.company.findUnique.mockResolvedValue(company);

      await companyService.update(
        PLATFORM_COMPANY_ID,
        { fantasyName: "Plataforma" },
        superAdminUser,
      );

      expect(prismaMock.company.update).toHaveBeenCalled();
    });

    it("deve lançar NotFoundException para empresa inexistente", async () => {
      prismaMock.company.findUnique.mockResolvedValue(null);

      await expect(
        companyService.update(COMPANY_ID, { fantasyName: "X" }, superAdminUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("deve lançar ConflictException quando o novo CNPJ já existe", async () => {
      prismaMock.company.findUnique.mockResolvedValue(company);
      prismaMock.company.update.mockRejectedValueOnce(uniqueViolation());

      await expect(
        companyService.update(
          COMPANY_ID,
          { cnpj: "11444777000161" },
          superAdminUser,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
