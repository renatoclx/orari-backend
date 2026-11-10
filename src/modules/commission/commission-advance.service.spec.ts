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
  };
  const prismaMock = {
    people: { findFirst: vi.fn() },
    commissionAdvance: { findFirst: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new CommissionAdvanceService(
    prismaMock as unknown as PrismaService,
    { getTimeZone: vi.fn().mockResolvedValue(TZ) } as unknown as CompanyService,
  );
  const dto = { professionalId: "p-1", amount: 30, date: "2026-11-10" };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.people.findFirst.mockResolvedValue({ id: "p-1" });
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
