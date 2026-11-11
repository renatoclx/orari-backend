import { BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyService } from "../company/company.service";
import {
  CommissionAdvanceService,
  availableOf,
} from "./commission-advance.service";

const d = (value: number) => new Decimal(value);
const TZ = "America/Sao_Paulo";
// 10/11/2026 às 21h em São Paulo (já 11/11 em UTC).
const NOW = new Date("2026-11-11T00:00:00Z");

describe("availableOf", () => {
  it("comissão em aberto menos o adiantado, nunca negativo", () => {
    expect(availableOf({ commission: d(48), advanced: d(30) })).toEqual(d(18));
    expect(availableOf({ commission: d(10), advanced: d(30) })).toEqual(d(0));
  });
});

describe("CommissionAdvanceService.create", () => {
  const tx = {
    $queryRaw: vi.fn(),
    commission: { aggregate: vi.fn() },
    commissionAdvance: { aggregate: vi.fn(), create: vi.fn() },
    expenseCategory: { findFirst: vi.fn(), create: vi.fn() },
    payable: { create: vi.fn() },
  };
  const prismaMock = {
    people: { findFirst: vi.fn() },
    paymentMethod: { findFirst: vi.fn() },
    payable: { deleteMany: vi.fn() },
    commissionAdvance: {
      findFirst: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === "function"
        ? (arg as (client: typeof tx) => unknown)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  const service = new CommissionAdvanceService(
    prismaMock as unknown as PrismaService,
    { getTimeZone: vi.fn().mockResolvedValue(TZ) } as unknown as CompanyService,
  );
  const dto = {
    professionalId: "p-1",
    amount: 30,
    date: "2026-11-10",
    paymentMethodId: "m-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.people.findFirst.mockResolvedValue({ id: "p-1" });
    prismaMock.paymentMethod.findFirst.mockResolvedValue({ id: "m-1" });
    tx.expenseCategory.findFirst.mockResolvedValue({ id: "cat-com" });
    tx.commission.aggregate.mockResolvedValue({ _sum: { amount: d(48) } });
    tx.commissionAdvance.aggregate.mockResolvedValue({
      _sum: { amount: d(10) },
    });
    tx.commissionAdvance.create.mockResolvedValue({
      id: "a-1",
      amount: d(30),
      date: new Date("2026-11-10T00:00:00Z"),
      note: null,
      createdAt: NOW,
      createdBy: { id: "u-1", name: "Marina" },
    });
  });

  it("lança dentro do disponível, travando o profissional", async () => {
    const result = await service.create(dto, "co-1", "u-1", NOW);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.commissionAdvance.create.mock.calls[0][0]).toMatchObject({
      data: {
        companyId: "co-1",
        professionalId: "p-1",
        amount: 30,
        createdById: "u-1",
      },
    });
    expect(result).toMatchObject({ amount: "30.00", date: "2026-11-10" });
  });

  it("gera a conta paga no Contas a pagar, na categoria Comissões", async () => {
    await service.create(dto, "co-1", "u-1", NOW);
    expect(tx.payable.create.mock.calls[0][0]).toMatchObject({
      data: {
        payeeId: "p-1",
        categoryId: "cat-com",
        description: "Adiantamento de comissão",
        amount: 30,
        status: "PAID",
        paidAt: new Date("2026-11-10T00:00:00Z"),
        paymentMethodId: "m-1",
        commissionAdvanceId: "a-1",
      },
    });
  });

  it("sem a categoria Comissões ativa: cria de novo", async () => {
    tx.expenseCategory.findFirst.mockResolvedValue(null);
    tx.expenseCategory.create.mockResolvedValue({ id: "cat-new" });
    await service.create(dto, "co-1", "u-1", NOW);
    expect(tx.expenseCategory.create).toHaveBeenCalledWith({
      data: {
        companyId: "co-1",
        name: "Comissões",
        normalizedName: "comissoes",
      },
      select: { id: true },
    });
    expect(tx.payable.create.mock.calls[0][0]).toMatchObject({
      data: { categoryId: "cat-new" },
    });
  });

  it("método inativo ou de outra empresa: 400 e nada é gravado", async () => {
    prismaMock.paymentMethod.findFirst.mockResolvedValue(null);
    await expect(service.create(dto, "co-1", "u-1", NOW)).rejects.toThrow(
      "método de pagamento ativo",
    );
    expect(tx.commissionAdvance.create).not.toHaveBeenCalled();
  });

  it("excluir em aberto: apaga a conta gerada junto", async () => {
    prismaMock.commissionAdvance.findFirst.mockResolvedValue({
      id: "a-1",
      closingId: null,
    });
    await service.remove("a-1", "co-1");
    expect(prismaMock.payable.deleteMany).toHaveBeenCalledWith({
      where: { commissionAdvanceId: "a-1" },
    });
    expect(prismaMock.commissionAdvance.delete).toHaveBeenCalledWith({
      where: { id: "a-1" },
    });
  });

  it("acima do disponível: 400 e nada é gravado", async () => {
    await expect(
      service.create({ ...dto, amount: 40 }, "co-1", "u-1", NOW),
    ).rejects.toThrow("disponível para adiantar (R$ 38,00)");
    expect(tx.commissionAdvance.create).not.toHaveBeenCalled();
  });

  it("data futura no fuso da empresa: 400", async () => {
    await expect(
      service.create({ ...dto, date: "2026-11-11" }, "co-1", "u-1", NOW),
    ).rejects.toThrow(BadRequestException);
  });

  it("profissional de outra empresa: 404", async () => {
    prismaMock.people.findFirst.mockResolvedValue(null);
    await expect(service.create(dto, "co-1", "u-1", NOW)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("lista os do período (abertos ou fechados) e os abertos de qualquer data", async () => {
    prismaMock.commissionAdvance.findMany.mockResolvedValue([
      {
        id: "a-1",
        amount: d(30),
        date: new Date("2026-11-10T00:00:00Z"),
        note: "Vale",
        createdAt: NOW,
        createdBy: { id: "u-1", name: "Marina" },
        closing: { id: "f-1", number: 1 },
      },
    ]);
    const result = await service.list({ professionalId: "p-1" }, "co-1", NOW);
    expect(
      (
        prismaMock.commissionAdvance.findMany.mock.calls[0][0] as {
          where: object;
        }
      ).where,
    ).toEqual({
      companyId: "co-1",
      professionalId: "p-1",
      OR: [
        { closingId: null },
        {
          date: {
            gte: new Date("2026-11-01T00:00:00Z"),
            lte: new Date("2026-11-30T00:00:00Z"),
          },
        },
      ],
    });
    expect(result[0]).toMatchObject({
      date: "2026-11-10",
      closing: { id: "f-1", number: 1 },
    });
  });

  it("excluir adiantamento já fechado: 409", async () => {
    prismaMock.commissionAdvance.findFirst.mockResolvedValue({
      id: "a-1",
      closingId: "f-1",
    });
    await expect(service.remove("a-1", "co-1")).rejects.toThrow(
      "já foi fechado",
    );
    expect(prismaMock.commissionAdvance.delete).not.toHaveBeenCalled();
  });

  it("excluir de outra empresa: 404", async () => {
    prismaMock.commissionAdvance.findFirst.mockResolvedValue(null);
    await expect(service.remove("a-x", "co-1")).rejects.toThrow(
      NotFoundException,
    );
    expect(prismaMock.commissionAdvance.delete).not.toHaveBeenCalled();
  });
});
