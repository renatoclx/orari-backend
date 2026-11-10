import { BadRequestException, ConflictException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyService } from "../company/company.service";
import {
  PayableService,
  buildSeries,
  splitAmount,
  statusWhere,
} from "./payable.service";

const TZ = "America/Sao_Paulo";
// 10/11/2026 às 21h em São Paulo (já 11/11 em UTC).
const NOW = new Date("2026-11-11T00:00:00Z");
const TODAY = new Date("2026-11-10T00:00:00Z");
const money = (rows: { amount: Decimal }[]) =>
  rows.map((r) => r.amount.toFixed(2));
const days = (rows: { dueDate: Date }[]) =>
  rows.map((r) => r.dueDate.toISOString().slice(0, 10));

describe("splitAmount e buildSeries", () => {
  it("parcelar: a última leva o resto dos centavos", () => {
    expect(splitAmount(new Decimal(100), 3).map((d) => d.toFixed(2))).toEqual([
      "33.33",
      "33.33",
      "33.34",
    ]);
  });

  it("sem repetição: uma conta, sem parcela", () => {
    const series = buildSeries(
      new Decimal(300),
      new Date("2026-11-10T00:00:00Z"),
    );
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ installment: null, installments: null });
  });

  it("parcelar em 3: valor dividido, uma por mês (dia 31 no fim do mês)", () => {
    const series = buildSeries(
      new Decimal(100),
      new Date("2027-01-31T00:00:00Z"),
      {
        mode: "installments",
        count: 3,
      },
    );
    expect(money(series)).toEqual(["33.33", "33.33", "33.34"]);
    expect(days(series)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(series.map((s) => [s.installment, s.installments])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("repetir por 2 meses: o mesmo valor em cada mês", () => {
    const series = buildSeries(
      new Decimal(1200),
      new Date("2026-11-05T00:00:00Z"),
      {
        mode: "monthly",
        count: 2,
      },
    );
    expect(money(series)).toEqual(["1200.00", "1200.00"]);
    expect(days(series)).toEqual(["2026-11-05", "2026-12-05"]);
  });
});

describe("statusWhere", () => {
  it("atrasada e a vencer são pendentes pela data; o padrão é pendente", () => {
    expect(statusWhere("overdue", TODAY)).toEqual({
      status: "PENDING",
      dueDate: { lt: TODAY },
    });
    expect(statusWhere("upcoming", TODAY)).toEqual({
      status: "PENDING",
      dueDate: { gte: TODAY },
    });
    expect(statusWhere("pending", TODAY)).toEqual({ status: "PENDING" });
    expect(statusWhere("all", TODAY)).toEqual({});
  });
});

describe("PayableService", () => {
  const prismaMock = {
    people: { findFirst: vi.fn() },
    expenseCategory: { findFirst: vi.fn() },
    paymentMethod: { findFirst: vi.fn() },
    payable: {
      createMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  const service = new PayableService(
    prismaMock as unknown as PrismaService,
    { getTimeZone: vi.fn().mockResolvedValue(TZ) } as unknown as CompanyService,
  );
  const dto = {
    description: " Aluguel ",
    categoryId: "cat-1",
    amount: 1200,
    dueDate: "2026-11-05",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.people.findFirst.mockResolvedValue({ id: "p-1" });
    prismaMock.expenseCategory.findFirst.mockResolvedValue({ id: "cat-1" });
    prismaMock.paymentMethod.findFirst.mockResolvedValue({ id: "m-1" });
  });

  it("lança a série com o mesmo seriesId e quem lançou", async () => {
    const result = await service.create(
      { ...dto, repeat: { mode: "monthly", count: 3 } },
      "co-1",
      "u-1",
      NOW,
    );
    expect(result.count).toBe(3);
    const { data } = prismaMock.payable.createMany.mock.calls[0][0] as {
      data: Record<string, unknown>[];
    };
    expect(data).toHaveLength(3);
    expect(new Set(data.map((row) => row.seriesId)).size).toBe(1);
    expect(data[0]).toMatchObject({
      description: "Aluguel",
      createdById: "u-1",
      installment: 1,
    });
  });

  it("já paga: nasce paga; com repetição ou data futura, 400", async () => {
    await service.create(
      { ...dto, paid: { paidAt: "2026-11-10", paymentMethodId: "m-1" } },
      "co-1",
      "u-1",
      NOW,
    );
    expect(
      (prismaMock.payable.createMany.mock.calls[0][0] as { data: object[] })
        .data[0],
    ).toMatchObject({ status: "PAID", paymentMethodId: "m-1" });

    await expect(
      service.create(
        {
          ...dto,
          repeat: { mode: "monthly", count: 2 },
          paid: { paidAt: "2026-11-10", paymentMethodId: "m-1" },
        },
        "co-1",
        "u-1",
        NOW,
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create(
        { ...dto, paid: { paidAt: "2026-11-11", paymentMethodId: "m-1" } },
        "co-1",
        "u-1",
        NOW,
      ),
    ).rejects.toThrow("A data do pagamento não pode ser futura");
  });

  it("favorecido que não é fornecedor nem profissional: 400", async () => {
    prismaMock.people.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ ...dto, payeeId: "c-1" }, "co-1", "u-1", NOW),
    ).rejects.toThrow("fornecedor ou profissional");
  });

  it("pagar em lote: alguma não pendente, 409 e nada muda", async () => {
    prismaMock.payable.count.mockResolvedValue(1);
    await expect(
      service.settle(
        { ids: ["a", "b"], paidAt: "2026-11-10", paymentMethodId: "m-1" },
        "co-1",
        NOW,
      ),
    ).rejects.toThrow(ConflictException);
    expect(prismaMock.payable.updateMany).not.toHaveBeenCalled();
  });

  it("alterar e cancelar só pendente; excluir não aceita paga", async () => {
    prismaMock.payable.findFirst.mockResolvedValue({ status: "PAID" });
    await expect(service.cancel("a", "co-1")).rejects.toThrow(
      "Só conta pendente pode ser cancelada",
    );
    await expect(service.remove("a", "co-1")).rejects.toThrow(
      "Conta paga não pode ser excluída",
    );
    prismaMock.payable.findFirst.mockResolvedValue({ status: "CANCELLED" });
    await service.remove("a", "co-1");
    expect(prismaMock.payable.delete).toHaveBeenCalledWith({
      where: { id: "a" },
    });
  });
});
