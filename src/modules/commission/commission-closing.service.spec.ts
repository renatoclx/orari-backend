import { BadRequestException, ConflictException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyService } from "../company/company.service";
import { CommissionClosingService } from "./commission-closing.service";

const d = (value: number) => new Decimal(value);
const TZ = "America/Sao_Paulo";
const NOW = new Date("2026-11-30T20:00:00Z");

describe("CommissionClosingService", () => {
  const tx = {
    $queryRaw: vi.fn(),
    commission: { findMany: vi.fn(), updateMany: vi.fn() },
    commissionAdvance: { findMany: vi.fn(), updateMany: vi.fn() },
    commissionClosing: { aggregate: vi.fn(), create: vi.fn() },
  };
  const prismaMock = {
    people: { findFirst: vi.fn() },
    paymentMethod: { findFirst: vi.fn() },
    commission: { aggregate: vi.fn(), updateMany: vi.fn() },
    commissionAdvance: { aggregate: vi.fn(), updateMany: vi.fn() },
    commissionClosing: { findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === "function"
        ? (arg as (client: typeof tx) => unknown)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  const service = new CommissionClosingService(
    prismaMock as unknown as PrismaService,
    { getTimeZone: vi.fn().mockResolvedValue(TZ) } as unknown as CompanyService,
  );
  const dto = {
    professionalId: "p-1",
    until: "2026-11-30",
    paymentMethodId: "m-1",
    paidAt: "2026-11-30",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.people.findFirst.mockResolvedValue({ id: "p-1" });
    prismaMock.paymentMethod.findFirst.mockResolvedValue({ id: "m-1" });
    tx.commission.findMany.mockResolvedValue([
      {
        id: "c-1",
        baseAmount: d(10),
        amount: d(4),
        appointment: {
          startAt: new Date("2026-11-10T12:00:00Z"),
          client: { name: "Ana" },
          service: { name: "Pilates" },
        },
      },
      {
        id: "c-2",
        baseAmount: d(100),
        amount: d(44),
        appointment: {
          startAt: new Date("2026-11-20T12:00:00Z"),
          client: { name: "Bia" },
          service: { name: "Massagem" },
        },
      },
    ]);
    tx.commissionAdvance.findMany.mockResolvedValue([
      {
        id: "a-1",
        date: new Date("2026-11-10T00:00:00Z"),
        note: "Vale",
        amount: d(30),
      },
    ]);
    tx.commissionClosing.aggregate.mockResolvedValue({ _max: { number: 7 } });
    tx.commissionClosing.create.mockResolvedValue({ id: "f-1", number: 8 });
  });

  it("fecha: próximo número, totais, cópia do detalhamento e marca tudo", async () => {
    const result = await service.create(dto, "co-1", "u-1", NOW);
    expect(result).toEqual({ id: "f-1", number: 8 });
    // Empresa e profissional travados.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const { data } = tx.commissionClosing.create.mock.calls[0][0] as {
      data: Record<string, unknown> & { details: { commissions: unknown[] } };
    };
    expect(data).toMatchObject({
      number: 8,
      appointmentsCount: 2,
      createdById: "u-1",
    });
    expect((data.commissionTotal as Decimal).toFixed(2)).toBe("48.00");
    expect((data.advanceTotal as Decimal).toFixed(2)).toBe("30.00");
    expect((data.paidAmount as Decimal).toFixed(2)).toBe("18.00");
    expect(data.details.commissions[0]).toEqual({
      startAt: "2026-11-10T12:00:00.000Z",
      client: "Ana",
      service: "Pilates",
      base: "10.00",
      amount: "4.00",
    });
    expect(tx.commission.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c-1", "c-2"] } },
      data: { closingId: "f-1" },
    });
  });

  it("nada em aberto: 400; método inativo ou datas futuras: 400", async () => {
    tx.commission.findMany.mockResolvedValue([]);
    tx.commissionAdvance.findMany.mockResolvedValue([]);
    await expect(service.create(dto, "co-1", "u-1", NOW)).rejects.toThrow(
      "Nada em aberto até esta data",
    );
    prismaMock.paymentMethod.findFirst.mockResolvedValue(null);
    await expect(service.create(dto, "co-1", "u-1", NOW)).rejects.toThrow(
      BadRequestException,
    );
    prismaMock.paymentMethod.findFirst.mockResolvedValue({ id: "m-1" });
    await expect(
      service.create({ ...dto, paidAt: "2026-12-01" }, "co-1", "u-1", NOW),
    ).rejects.toThrow("A data do pagamento não pode ser futura");
  });

  it("desfazer: só o último do profissional; já desfeito é 409", async () => {
    prismaMock.commissionClosing.findFirst
      .mockResolvedValueOnce({
        id: "f-1",
        professionalId: "p-1",
        cancelledAt: null,
      })
      .mockResolvedValueOnce({ id: "f-2" });
    await expect(service.cancel("f-1", "co-1", "u-1")).rejects.toThrow(
      "Só o último fechamento do profissional pode ser desfeito",
    );

    prismaMock.commissionClosing.findFirst.mockResolvedValueOnce({
      id: "f-1",
      professionalId: "p-1",
      cancelledAt: new Date(),
    });
    await expect(service.cancel("f-1", "co-1", "u-1")).rejects.toThrow(
      ConflictException,
    );
  });

  it("desfazer o último: cancela e devolve ao em aberto", async () => {
    prismaMock.commissionClosing.findFirst
      .mockResolvedValueOnce({
        id: "f-2",
        professionalId: "p-1",
        cancelledAt: null,
      })
      .mockResolvedValueOnce({ id: "f-2" });
    await service.cancel("f-2", "co-1", "u-1");
    const { data } = prismaMock.commissionClosing.update.mock.calls[0][0] as {
      data: { cancelledAt: unknown; cancelledById: string };
    };
    expect(data.cancelledAt).toBeInstanceOf(Date);
    expect(data.cancelledById).toBe("u-1");
    expect(prismaMock.commission.updateMany).toHaveBeenCalledWith({
      where: { closingId: "f-2" },
      data: { closingId: null },
    });
    expect(prismaMock.commissionAdvance.updateMany).toHaveBeenCalledWith({
      where: { closingId: "f-2" },
      data: { closingId: null },
    });
  });
});
