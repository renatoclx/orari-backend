import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { LocalFileStorage } from "../../common/storage/local-file-storage.service";
import { PrismaService } from "../../prisma/prisma.service";
import { PeopleService } from "../people/people.service";
import { ProductCategoryService } from "../product-category/product-category.service";
import { ProductService } from "./product.service";

const COMPANY_ID = "company-1";
const anyDate: unknown = expect.any(Date);
const details = {
  omit: { normalizedName: true },
  include: {
    category: { select: { id: true, name: true } },
    supplier: { select: { id: true, name: true } },
  },
};
// Início de um PNG: o tipo da imagem é conferido pelo conteúdo.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

describe("ProductService", () => {
  let service: ProductService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    product: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };
  const categoryServiceMock = { ensureActive: vi.fn() };
  const peopleServiceMock = { findOne: vi.fn() };
  const storageMock = { save: vi.fn(), remove: vi.fn() };

  const dto = {
    name: "Óleo de massagem",
    categoryId: "cat-1",
    salePrice: 100,
    purchasePrice: 60,
    currentStock: 10,
  };
  // Como o banco devolve: preços em Decimal.
  const stored = {
    id: "prod-1",
    companyId: COMPANY_ID,
    categoryId: "cat-1",
    supplierId: null,
    name: "Óleo de massagem",
    sku: null,
    photoUrl: null,
    salePrice: new Decimal(100),
    purchasePrice: new Decimal(60),
    profitMargin: new Decimal(40),
    promotionalPrice: null,
    currentStock: 10,
    minimalStock: null,
    maximumStock: null,
    isActive: true,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.product.findFirst.mockResolvedValue(stored);
    prismaMock.product.update.mockResolvedValue(stored);
    peopleServiceMock.findOne.mockResolvedValue({ type: "SUPPLIER" });
    storageMock.save.mockResolvedValue("/uploads/products/nova.png");
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ProductCategoryService, useValue: categoryServiceMock },
        { provide: PeopleService, useValue: peopleServiceMock },
        { provide: LocalFileStorage, useValue: storageMock },
      ],
    }).compile();
    service = module.get(ProductService);
  });

  describe("create", () => {
    it("calcula a margem sobre a venda e grava na empresa do usuário", async () => {
      await service.create(dto, COMPANY_ID);

      expect(categoryServiceMock.ensureActive).toHaveBeenCalledWith(
        "cat-1",
        COMPANY_ID,
      );
      const { data } = prismaMock.product.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data).toMatchObject({
        ...dto,
        normalizedName: "oleo de massagem",
        companyId: COMPANY_ID,
      });
      expect(String(data.profitMargin)).toBe("40");
    });

    it("recusa a categoria inativa sem gravar", async () => {
      categoryServiceMock.ensureActive.mockRejectedValueOnce(
        new BadRequestException("A categoria de produto está inativa"),
      );

      await expect(service.create(dto, COMPANY_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prismaMock.product.create).not.toHaveBeenCalled();
    });

    it.each([
      [
        "promocional igual à venda",
        { promotionalPrice: 100 },
        "preço promocional",
      ],
      [
        "promocional acima da venda",
        { promotionalPrice: 120 },
        "preço promocional",
      ],
      [
        "mínimo acima do máximo",
        { minimalStock: 5, maximumStock: 3 },
        "estoque mínimo",
      ],
    ])("recusa %s (400)", async (_, override, message) => {
      await expect(
        service.create({ ...dto, ...override }, COMPANY_ID),
      ).rejects.toThrow(message);
      expect(prismaMock.product.create).not.toHaveBeenCalled();
    });

    it("aceita mínimo igual ao máximo e promocional abaixo da venda", async () => {
      await expect(
        service.create(
          { ...dto, promotionalPrice: 90, minimalStock: 3, maximumStock: 3 },
          COMPANY_ID,
        ),
      ).resolves.toBeUndefined();
      expect(prismaMock.product.create).toHaveBeenCalled();
    });

    it.each([
      [
        "de outro tipo",
        () => peopleServiceMock.findOne.mockResolvedValue({ type: "CLIENT" }),
      ],
      [
        "inexistente ou de outra empresa",
        () =>
          peopleServiceMock.findOne.mockRejectedValue(new NotFoundException()),
      ],
    ])("recusa fornecedor %s (400)", async (_, arrange) => {
      arrange();

      await expect(
        service.create({ ...dto, supplierId: "p-1" }, COMPANY_ID),
      ).rejects.toThrow(
        "O fornecedor precisa ser uma pessoa ativa do tipo SUPPLIER",
      );
    });

    it("SKU repetido na empresa responde 409", async () => {
      prismaMock.product.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(
        service.create({ ...dto, sku: "OL-01" }, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("findAll", () => {
    it("busca por nome ou SKU e ignora os excluídos", async () => {
      prismaMock.product.findMany.mockResolvedValue([stored]);
      prismaMock.product.count.mockResolvedValue(1);

      await service.findAll(
        {
          page: 1,
          limit: 10,
          search: "ÓLEO",
          categoryId: "cat-1",
          isActive: true,
        },
        COMPANY_ID,
      );

      expect(prismaMock.product.findMany).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY_ID,
          deletedAt: null,
          categoryId: "cat-1",
          supplierId: undefined,
          isActive: true,
          OR: [
            { normalizedName: { contains: "oleo" } },
            { sku: { contains: "ÓLEO", mode: "insensitive" } },
          ],
        },
        ...details,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: 0,
        take: 10,
      });
    });
  });

  it("produto excluído ou de outra empresa responde 404", async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);

    await expect(service.findOne("prod-1", COMPANY_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prismaMock.product.findFirst).toHaveBeenCalledWith({
      where: { id: "prod-1", companyId: COMPANY_ID, deletedAt: null },
      ...details,
    });
  });

  describe("update", () => {
    const dataOf = () =>
      (
        prismaMock.product.update.mock.calls[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;

    it("recalcula a margem com o que não veio do que está gravado", async () => {
      await service.update("prod-1", { purchasePrice: 75 }, COMPANY_ID);

      expect(String(dataOf().profitMargin)).toBe("25");
      // Sem trocar de categoria nem reativar, ela não é conferida.
      expect(categoryServiceMock.ensureActive).not.toHaveBeenCalled();
    });

    it("confere a regra do promocional com o preço de venda gravado", async () => {
      await expect(
        service.update("prod-1", { promotionalPrice: 100 }, COMPANY_ID),
      ).rejects.toThrow("preço promocional");
    });

    it("baixar a venda abaixo do promocional gravado é recusado", async () => {
      prismaMock.product.findFirst.mockResolvedValue({
        ...stored,
        promotionalPrice: new Decimal(80),
      });

      await expect(
        service.update("prod-1", { salePrice: 70 }, COMPANY_ID),
      ).rejects.toThrow("preço promocional");
    });

    it("null remove o promocional, o fornecedor e os limites do estoque", async () => {
      await service.update(
        "prod-1",
        { promotionalPrice: null, supplierId: null, minimalStock: null },
        COMPANY_ID,
      );

      expect(dataOf()).toMatchObject({
        promotionalPrice: null,
        supplierId: null,
        minimalStock: null,
      });
      expect(peopleServiceMock.findOne).not.toHaveBeenCalled();
    });

    it("trocar de categoria ou reativar confere a categoria", async () => {
      await service.update("prod-1", { categoryId: "cat-2" }, COMPANY_ID);
      expect(categoryServiceMock.ensureActive).toHaveBeenLastCalledWith(
        "cat-2",
        COMPANY_ID,
      );

      prismaMock.product.findFirst.mockResolvedValue({
        ...stored,
        isActive: false,
      });
      await service.update("prod-1", { isActive: true }, COMPANY_ID);
      expect(categoryServiceMock.ensureActive).toHaveBeenLastCalledWith(
        "cat-1",
        COMPANY_ID,
      );
    });

    it("renomear mantém a coluna de busca em sincronia", async () => {
      await service.update("prod-1", { name: "Creme" }, COMPANY_ID);

      expect(dataOf()).toMatchObject({
        name: "Creme",
        normalizedName: "creme",
        updatedAt: anyDate,
      });
    });
  });

  it("exclusão é lógica", async () => {
    await service.remove("prod-1", COMPANY_ID);

    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: "prod-1" },
      data: { deletedAt: anyDate, updatedAt: anyDate },
    });
  });

  describe("foto", () => {
    it("grava a nova e só então apaga a anterior", async () => {
      prismaMock.product.findFirst.mockResolvedValue({
        ...stored,
        photoUrl: "/uploads/products/velha.png",
      });

      await service.updatePhoto("prod-1", PNG, COMPANY_ID);

      expect(storageMock.save).toHaveBeenCalledWith("products", PNG, "png");
      expect(prismaMock.product.update).toHaveBeenCalledWith({
        where: { id: "prod-1" },
        data: { photoUrl: "/uploads/products/nova.png", updatedAt: anyDate },
        ...details,
      });
      expect(storageMock.remove).toHaveBeenCalledWith(
        "/uploads/products/velha.png",
      );
    });

    it("recusa arquivo que não é JPEG nem PNG (400)", async () => {
      await expect(
        service.updatePhoto("prod-1", Buffer.from("texto"), COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storageMock.save).not.toHaveBeenCalled();
    });

    it("remover sem foto não faz nada", async () => {
      await service.removePhoto("prod-1", COMPANY_ID);

      expect(prismaMock.product.update).not.toHaveBeenCalled();
      expect(storageMock.remove).not.toHaveBeenCalled();
    });
  });
});
