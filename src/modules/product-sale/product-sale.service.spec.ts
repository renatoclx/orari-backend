import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { ProductSaleService } from "./product-sale.service";

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
// 02:00 UTC de 12/11 ainda é 11/11 em São Paulo.
const NOW = new Date("2026-11-12T02:00:00Z");

describe("ProductSaleService", () => {
  let service: ProductSaleService;
  const prismaMock = {
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn(prismaMock),
    ),
    people: { findFirst: vi.fn() },
    product: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    productSale: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    stockMovement: { create: vi.fn() },
    payment: { create: vi.fn(), updateMany: vi.fn() },
  };
  const companyMock = { getTimeZone: vi.fn() };

  const products = [
    { id: "p1", name: "Sérum", isActive: true },
    { id: "p2", name: "Protetor", isActive: true },
  ];
  const dto = {
    clientId: "c1",
    items: [
      { productId: "p1", quantity: 2, unitPrice: 109.9 },
      { productId: "p2", quantity: 1, unitPrice: 89.9 },
    ],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.people.findFirst.mockResolvedValue({ id: "c1" });
    prismaMock.product.findMany.mockResolvedValue(products);
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.product.findUniqueOrThrow.mockResolvedValue({ currentStock: 8 });
    prismaMock.productSale.create.mockResolvedValue({ id: "sale-1" });
    prismaMock.productSale.findUniqueOrThrow.mockResolvedValue({
      id: "sale-1",
    });
    companyMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductSaleService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CompanyService, useValue: companyMock },
      ],
    }).compile();
    service = module.get(ProductSaleService);
  });

  describe("findProducts", () => {
    it("só ativos e não excluídos, por nome ou SKU, até 20", async () => {
      prismaMock.product.findMany.mockResolvedValue([]);

      await service.findProducts("SÉRUM", COMPANY_ID);

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId: COMPANY_ID,
            deletedAt: null,
            isActive: true,
            OR: [
              { normalizedName: { contains: "serum" } },
              { sku: { contains: "SÉRUM", mode: "insensitive" } },
            ],
          },
          take: 20,
        }),
      );
    });
  });

  describe("create", () => {
    it("grava a venda, tira cada item do estoque e cria o pagamento pendente com o total", async () => {
      await service.create(dto, COMPANY_ID, USER_ID, NOW);

      const saleData: unknown = expect.objectContaining({
        companyId: COMPANY_ID,
        clientId: "c1",
        createdById: USER_ID,
      });
      expect(prismaMock.productSale.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: saleData }),
      );
      // Só tira se houver o suficiente.
      expect(prismaMock.product.updateMany).toHaveBeenCalledWith({
        where: { id: "p1", currentStock: { gte: 2 } },
        data: { currentStock: { decrement: 2 }, updatedAt: NOW },
      });
      expect(prismaMock.stockMovement.create).toHaveBeenCalledWith({
        data: {
          companyId: COMPANY_ID,
          productId: "p1",
          type: "SALE",
          quantity: -2,
          balanceAfter: 8,
          createdById: USER_ID,
          productSaleId: "sale-1",
        },
      });
      const { data } = prismaMock.payment.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(String(data.amount)).toBe("309.7");
      expect(data).toMatchObject({
        productSaleId: "sale-1",
        status: "PENDING",
        // Vence hoje no calendário da empresa (11/11 em São Paulo).
        dueDate: new Date("2026-11-11T00:00:00Z"),
      });
    });

    it("estoque insuficiente responde 409 com o produto e o saldo", async () => {
      prismaMock.product.updateMany.mockResolvedValueOnce({ count: 0 });
      prismaMock.product.findUniqueOrThrow.mockResolvedValueOnce({
        currentStock: 1,
      });

      await expect(
        service.create(dto, COMPANY_ID, USER_ID, NOW),
      ).rejects.toThrow("Estoque insuficiente de Sérum: há 1 em estoque");
      expect(prismaMock.payment.create).not.toHaveBeenCalled();
    });

    it("produto repetido é recusado (400)", async () => {
      await expect(
        service.create(
          { clientId: "c1", items: [dto.items[0], dto.items[0]] },
          COMPANY_ID,
          USER_ID,
        ),
      ).rejects.toThrow("junte as quantidades");
    });

    it("cliente inválido (outro tipo, inativo ou de outra empresa) é recusado (400)", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);

      await expect(
        service.create(dto, COMPANY_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("produto inativo é recusado (400) e o inexistente responde 404", async () => {
      prismaMock.product.findMany.mockResolvedValueOnce([
        products[0],
        { ...products[1], isActive: false },
      ]);
      await expect(service.create(dto, COMPANY_ID, USER_ID)).rejects.toThrow(
        "O produto Protetor está inativo",
      );

      prismaMock.product.findMany.mockResolvedValueOnce([products[0]]);
      await expect(
        service.create(dto, COMPANY_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("cancel", () => {
    const pending = {
      cancelledAt: null,
      items: [{ productId: "p1", quantity: 2 }],
      payment: { id: "pay-1", status: "PENDING" },
    };

    it("cancela o pagamento e devolve cada item ao estoque", async () => {
      prismaMock.productSale.findFirst.mockResolvedValue(pending);
      prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.product.update.mockResolvedValue({ currentStock: 10 });

      await service.cancel("sale-1", COMPANY_ID, USER_ID, NOW);

      expect(prismaMock.payment.updateMany).toHaveBeenCalledWith({
        where: { productSaleId: "sale-1", status: "PENDING", deletedAt: null },
        data: { status: "CANCELLED", updatedAt: NOW },
      });
      const returned: unknown = expect.objectContaining({
        type: "SALE_CANCELLED",
        quantity: 2,
        balanceAfter: 10,
        productSaleId: "sale-1",
      });
      expect(prismaMock.stockMovement.create).toHaveBeenCalledWith({
        data: returned,
      });
      expect(prismaMock.productSale.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { cancelledAt: NOW, cancelledById: USER_ID },
        }),
      );
    });

    it("venda recebida não se cancela (409)", async () => {
      prismaMock.productSale.findFirst.mockResolvedValue({
        ...pending,
        payment: { id: "pay-1", status: "PAID" },
      });

      await expect(
        service.cancel("sale-1", COMPANY_ID, USER_ID),
      ).rejects.toThrow("Venda já recebida não pode ser cancelada");
    });

    it("recebida no meio do cancelamento: 409 e nada volta ao estoque", async () => {
      prismaMock.productSale.findFirst.mockResolvedValue(pending);
      prismaMock.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.cancel("sale-1", COMPANY_ID, USER_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.product.update).not.toHaveBeenCalled();
    });

    it("já cancelada responde 409 e de outra empresa, 404", async () => {
      prismaMock.productSale.findFirst.mockResolvedValueOnce({
        ...pending,
        cancelledAt: NOW,
      });
      await expect(
        service.cancel("sale-1", COMPANY_ID, USER_ID),
      ).rejects.toThrow("A venda já foi cancelada");

      prismaMock.productSale.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.cancel("sale-1", COMPANY_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
