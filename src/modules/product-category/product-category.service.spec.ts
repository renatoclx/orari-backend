import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ProductCategoryService } from "./product-category.service";

const COMPANY_ID = "company-1";
const anyDate: unknown = expect.any(Date);
const omit = { normalizedName: true };

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });

describe("ProductCategoryService", () => {
  let service: ProductCategoryService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    productCategory: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    product: { count: vi.fn() },
  };
  const stored = {
    id: "cat-1",
    name: "Cosméticos",
    isActive: true,
    companyId: COMPANY_ID,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.productCategory.findFirst.mockResolvedValue(stored);
    prismaMock.productCategory.update.mockResolvedValue(stored);
    prismaMock.product.count.mockResolvedValue(0);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductCategoryService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(ProductCategoryService);
  });

  it("cria na empresa do usuário, com o nome normalizado", async () => {
    await service.create({ name: "Cosméticos" }, COMPANY_ID);

    expect(prismaMock.productCategory.create).toHaveBeenCalledWith({
      data: {
        name: "Cosméticos",
        normalizedName: "cosmeticos",
        companyId: COMPANY_ID,
      },
      omit,
    });
  });

  it("nome repetido na empresa responde 409", async () => {
    prismaMock.productCategory.create.mockRejectedValue(uniqueViolation());

    await expect(
      service.create({ name: "cosmeticos" }, COMPANY_ID),
    ).rejects.toThrow("Já existe uma categoria de produto com este nome");
  });

  it("lista com os filtros de nome e situação, em ordem de nome", async () => {
    prismaMock.productCategory.findMany.mockResolvedValue([stored]);
    prismaMock.productCategory.count.mockResolvedValue(1);

    await service.findAll(
      { page: 2, limit: 5, name: "COSMÉ", isActive: true },
      COMPANY_ID,
    );

    expect(prismaMock.productCategory.findMany).toHaveBeenCalledWith({
      where: {
        companyId: COMPANY_ID,
        isActive: true,
        normalizedName: { contains: "cosme" },
      },
      omit,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: 5,
      take: 5,
    });
  });

  it("categoria de outra empresa responde 404", async () => {
    prismaMock.productCategory.findFirst.mockResolvedValue(null);

    await expect(service.findOne("cat-1", COMPANY_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prismaMock.productCategory.findFirst).toHaveBeenCalledWith({
      where: { id: "cat-1", companyId: COMPANY_ID },
      omit,
    });
  });

  describe("update", () => {
    it("renomeia mantendo a coluna de busca em sincronia", async () => {
      await service.update("cat-1", { name: "Acessórios" }, COMPANY_ID);

      expect(prismaMock.productCategory.update).toHaveBeenCalledWith({
        where: { id: "cat-1" },
        data: {
          name: "Acessórios",
          normalizedName: "acessorios",
          updatedAt: anyDate,
        },
        omit,
      });
    });

    it("inativa a categoria sem produtos ativos", async () => {
      await service.update("cat-1", { isActive: false }, COMPANY_ID);

      expect(prismaMock.product.count).toHaveBeenCalledWith({
        where: { categoryId: "cat-1", isActive: true, deletedAt: null },
      });
      expect(prismaMock.productCategory.update).toHaveBeenCalled();
    });

    it("recusa inativar com produtos ativos (409)", async () => {
      prismaMock.product.count.mockResolvedValue(2);

      await expect(
        service.update("cat-1", { isActive: false }, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.productCategory.update).not.toHaveBeenCalled();
    });

    it("reativar não confere os produtos", async () => {
      prismaMock.productCategory.findFirst.mockResolvedValue({
        ...stored,
        isActive: false,
      });

      await service.update("cat-1", { isActive: true }, COMPANY_ID);

      expect(prismaMock.product.count).not.toHaveBeenCalled();
    });
  });

  describe("ensureActive (cadastro do produto)", () => {
    it("aceita a categoria ativa", async () => {
      await expect(
        service.ensureActive("cat-1", COMPANY_ID),
      ).resolves.toBeUndefined();
    });

    it("recusa a inativa (400) e a de outra empresa (404)", async () => {
      prismaMock.productCategory.findFirst.mockResolvedValueOnce({
        ...stored,
        isActive: false,
      });
      await expect(
        service.ensureActive("cat-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);

      prismaMock.productCategory.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.ensureActive("cat-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
