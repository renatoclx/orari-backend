import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyAccessService } from "../company-access/company-access.service";
import { PayableService } from "../payable/payable.service";
import { StockMovementService } from "./stock-movement.service";

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const NOW = new Date("2026-11-11T15:00:00Z");

describe("StockMovementService", () => {
  let service: StockMovementService;
  const prismaMock = {
    $transaction: vi.fn(
      (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
        typeof arg === "function" ? arg(prismaMock) : Promise.all(arg),
    ),
    product: { findFirst: vi.fn(), updateMany: vi.fn() },
    payable: { create: vi.fn() },
    stockMovement: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  };
  const payableServiceMock = { ensureNewPayable: vi.fn() };
  const accessMock = { can: vi.fn() };

  // Venda 100, estoque 10, fornecedor cadastrado.
  const product = {
    id: "prod-1",
    name: "Óleo de massagem",
    currentStock: 10,
    salePrice: new Decimal(100),
    supplierId: "sup-1",
  };

  const productUpdate = () =>
    prismaMock.product.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
  const movementData = () =>
    (
      prismaMock.stockMovement.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.product.findFirst.mockResolvedValue(product);
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.payable.create.mockResolvedValue({ id: "pay-1" });
    prismaMock.stockMovement.create.mockResolvedValue({ id: "mov-1" });
    accessMock.can.mockResolvedValue(true);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockMovementService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PayableService, useValue: payableServiceMock },
        { provide: CompanyAccessService, useValue: accessMock },
      ],
    }).compile();
    service = module.get(StockMovementService);
  });

  const create = (dto: object) =>
    service.create(
      "prod-1",
      dto as Parameters<StockMovementService["create"]>[1],
      COMPANY_ID,
      USER_ID,
      NOW,
    );

  describe("create", () => {
    it("entrada por compra soma, atualiza o custo e recalcula a margem", async () => {
      await create({ type: "PURCHASE", quantity: 5, unitCost: 70 });

      const { where, data } = productUpdate();
      // Só grava se o saldo lido não mudou.
      expect(where).toEqual({ id: "prod-1", currentStock: 10 });
      expect(data.currentStock).toBe(15);
      expect(String(data.purchasePrice)).toBe("70");
      expect(String(data.profitMargin)).toBe("30");
      expect(movementData()).toMatchObject({
        type: "PURCHASE",
        quantity: 5,
        balanceAfter: 15,
        createdById: USER_ID,
        payableId: null,
      });
      expect(prismaMock.payable.create).not.toHaveBeenCalled();
    });

    it.each([["INTERNAL_USE"], ["LOSS"]])(
      "%s subtrai a quantidade e não mexe no custo",
      async (type) => {
        await create({ type, quantity: 3, note: " frasco quebrado " });

        const { data } = productUpdate();
        expect(data.currentStock).toBe(7);
        expect(data).not.toHaveProperty("purchasePrice");
        expect(movementData()).toMatchObject({
          type,
          quantity: -3,
          balanceAfter: 7,
          unitCost: null,
          note: "frasco quebrado",
        });
      },
    );

    it("ajuste grava a diferença até o saldo contado", async () => {
      await create({ type: "ADJUSTMENT", quantity: 8 });

      expect(productUpdate().data.currentStock).toBe(8);
      expect(movementData()).toMatchObject({ quantity: -2, balanceAfter: 8 });
    });

    it("ajuste igual ao estoque atual é recusado (400)", async () => {
      await expect(
        create({ type: "ADJUSTMENT", quantity: 10 }),
      ).rejects.toThrow("O saldo contado é igual ao estoque atual");
    });

    it("saída maior que o estoque é recusada (409) sem gravar", async () => {
      await expect(create({ type: "LOSS", quantity: 11 })).rejects.toThrow(
        "Estoque insuficiente: há 10 em estoque",
      );
      expect(prismaMock.product.updateMany).not.toHaveBeenCalled();
    });

    it("quantidade zero fora do ajuste é recusada (400)", async () => {
      await expect(
        create({ type: "INTERNAL_USE", quantity: 0 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("custo ou conta fora da compra é recusado (400)", async () => {
      await expect(
        create({ type: "LOSS", quantity: 1, unitCost: 10 }),
      ).rejects.toThrow("Custo e conta a pagar só valem na entrada por compra");
    });

    it("saldo mudado por outro lançamento ao mesmo tempo responde 409", async () => {
      prismaMock.product.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        create({ type: "INTERNAL_USE", quantity: 1 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.stockMovement.create).not.toHaveBeenCalled();
    });

    it("produto de outra empresa ou excluído responde 404", async () => {
      prismaMock.product.findFirst.mockResolvedValue(null);

      await expect(
        create({ type: "LOSS", quantity: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    describe("compra com conta a pagar", () => {
      const payable = { categoryId: "cat-1", dueDate: "2026-11-20" };

      it("lança a conta (quantidade × custo) com o fornecedor do produto e liga à movimentação", async () => {
        await create({
          type: "PURCHASE",
          quantity: 4,
          unitCost: 12.5,
          payable,
        });

        expect(payableServiceMock.ensureNewPayable).toHaveBeenCalledWith(
          { payeeId: "sup-1", categoryId: "cat-1", paid: undefined },
          COMPANY_ID,
          NOW,
        );
        const { data } = prismaMock.payable.create.mock.calls[0][0] as {
          data: Record<string, unknown>;
        };
        expect(data).toMatchObject({
          companyId: COMPANY_ID,
          description: "Compra: Óleo de massagem (4)",
          payeeId: "sup-1",
          categoryId: "cat-1",
          dueDate: new Date("2026-11-20T00:00:00Z"),
          createdById: USER_ID,
        });
        expect(String(data.amount)).toBe("50");
        expect(data).not.toHaveProperty("status");
        expect(movementData().payableId).toBe("pay-1");
      });

      it("já paga: nasce PAID com a data e o método; payeeId null tira o favorecido", async () => {
        await create({
          type: "PURCHASE",
          quantity: 1,
          unitCost: 10,
          payable: {
            ...payable,
            payeeId: null,
            paid: { paidAt: "2026-11-11", paymentMethodId: "met-1" },
          },
        });

        const { data } = prismaMock.payable.create.mock.calls[0][0] as {
          data: Record<string, unknown>;
        };
        expect(data).toMatchObject({
          payeeId: null,
          status: "PAID",
          paidAt: new Date("2026-11-11T00:00:00Z"),
          paymentMethodId: "met-1",
        });
      });

      it("sem o Contas a pagar no plano, recusa (403) sem gravar nada", async () => {
        accessMock.can.mockResolvedValue(false);

        await expect(
          create({ type: "PURCHASE", quantity: 1, unitCost: 10, payable }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(accessMock.can).toHaveBeenCalledWith(
          COMPANY_ID,
          "payables",
          "create",
        );
        expect(prismaMock.product.updateMany).not.toHaveBeenCalled();
      });

      it("categoria ou favorecido inválidos: o erro do Contas a pagar volta antes de gravar", async () => {
        payableServiceMock.ensureNewPayable.mockRejectedValueOnce(
          new BadRequestException("Escolha uma categoria de despesa ativa"),
        );

        await expect(
          create({ type: "PURCHASE", quantity: 1, unitCost: 10, payable }),
        ).rejects.toThrow("Escolha uma categoria de despesa ativa");
        expect(prismaMock.product.updateMany).not.toHaveBeenCalled();
      });
    });
  });

  describe("findAll", () => {
    it("histórico do produto, da mais recente para a mais antiga", async () => {
      prismaMock.stockMovement.findMany.mockResolvedValue([]);
      prismaMock.stockMovement.count.mockResolvedValue(0);

      await expect(
        service.findAll("prod-1", { page: 2, limit: 5 }, COMPANY_ID),
      ).resolves.toEqual({ items: [], total: 0, page: 2, limit: 5 });

      expect(prismaMock.stockMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productId: "prod-1", companyId: COMPANY_ID },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: 5,
          take: 5,
        }),
      );
    });
  });
});
