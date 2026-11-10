import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { periodOf } from "../../common/time/report-period";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyService } from "../company/company.service";
import {
  FinancialReportService,
  summarizeReceived,
  type ReceivedPayment,
} from "./financial-report.service";

const TZ = "America/Sao_Paulo"; // UTC-3
const NOW = new Date("2026-11-15T15:00:00.000Z");
const NOVEMBER = periodOf(undefined, undefined, TZ, NOW);

const pix = { id: "m-pix", name: "Pix" };
const card = { id: "m-card", name: "Cartão" };

const paid = (
  paidAt: string,
  amount: number,
  overrides: Partial<ReceivedPayment> = {},
): ReceivedPayment => ({
  paidAt: new Date(paidAt),
  amount: new Decimal(amount),
  origin: "appointment",
  method: pix,
  ...overrides,
});

describe("summarizeReceived", () => {
  const payments = [
    paid("2026-11-02T12:00:00Z", 80),
    paid("2026-11-02T15:00:00Z", 120, { method: card }),
    paid("2026-11-03T12:00:00Z", 500, { origin: "package", method: card }),
    // 05/11 às 22h local (06/11 01h UTC): conta no dia 05.
    paid("2026-11-06T01:00:00Z", 50, { method: null }),
  ];
  const report = summarizeReceived(payments, NOVEMBER, TZ);

  it("totais por origem", () => {
    expect(report).toMatchObject({
      received: { count: 4, amount: "750.00" },
      appointments: { count: 3, amount: "250.00" },
      packages: { count: 1, amount: "500.00" },
    });
  });

  it("série por dia, no dia da empresa", () => {
    expect(report.series.unit).toBe("day");
    expect(report.series.points).toHaveLength(30);
    expect(report.series.points[1]).toEqual({
      date: "2026-11-02",
      appointments: "200.00",
      packages: "0.00",
    });
    expect(report.series.points[2].packages).toBe("500.00");
    expect(report.series.points[4].appointments).toBe("50.00");
  });

  it("por método, do maior para o menor, com o sem método à parte", () => {
    expect(report.byMethod).toEqual([
      {
        id: "m-card",
        name: "Cartão",
        count: 2,
        amount: "620.00",
        share: 620 / 750,
      },
      { id: "m-pix", name: "Pix", count: 1, amount: "80.00", share: 80 / 750 },
      { id: null, name: null, count: 1, amount: "50.00", share: 50 / 750 },
    ]);
  });

  it("sem pagamentos: zeros", () => {
    expect(summarizeReceived([], NOVEMBER, TZ)).toMatchObject({
      received: { count: 0, amount: "0.00" },
      byMethod: [],
    });
  });
});

describe("FinancialReportService", () => {
  const prismaMock = {
    payment: { findMany: vi.fn(), count: vi.fn() },
    paymentMethod: { findFirst: vi.fn() },
  };
  const companyMock = { getTimeZone: vi.fn() };
  const service = new FinancialReportService(
    prismaMock as unknown as PrismaService,
    companyMock as unknown as CompanyService,
  );
  const where = {
    companyId: "c-1",
    status: "PAID",
    deletedAt: null,
    paidAt: { gte: NOVEMBER.start, lt: NOVEMBER.end },
    paymentMethodId: undefined,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    companyMock.getTimeZone.mockResolvedValue(TZ);
    prismaMock.payment.findMany.mockResolvedValue([]);
    prismaMock.payment.count.mockResolvedValue(0);
  });

  it("só pagos, não excluídos, pela data do pagamento", async () => {
    prismaMock.payment.findMany.mockResolvedValue([
      {
        paidAt: new Date("2026-11-02T12:00:00Z"),
        amount: new Decimal(300),
        clientPlanId: "cp-1",
        paymentMethod: pix,
      },
    ]);
    const result = await service.report({}, "c-1", NOW);
    expect(
      (prismaMock.payment.findMany.mock.calls[0][0] as { where: object }).where,
    ).toEqual(where);
    expect(result.packages).toEqual({ count: 1, amount: "300.00" });
  });

  it("extrato: cliente e descrição pela origem", async () => {
    const ana = { id: "c-ana", name: "Ana" };
    prismaMock.payment.findMany.mockResolvedValue([
      {
        id: "p-1",
        paidAt: new Date("2026-11-03T12:00:00Z"),
        amount: new Decimal(500),
        paymentMethod: card,
        appointment: null,
        clientPlan: { client: ana, plan: { id: "pl-1", name: "Pilates 3x" } },
      },
      {
        id: "p-2",
        paidAt: new Date("2026-11-02T12:00:00Z"),
        amount: new Decimal(80),
        paymentMethod: pix,
        appointment: { client: ana, service: { id: "s-1", name: "Massagem" } },
        clientPlan: null,
      },
    ]);
    prismaMock.payment.count.mockResolvedValue(2);
    const result = await service.payments({ page: 1, limit: 10 }, "c-1", NOW);
    expect(result.total).toBe(2);
    expect(result.items.map((item) => [item.origin, item.description])).toEqual(
      [
        ["package", "Pilates 3x"],
        ["appointment", "Massagem"],
      ],
    );
    expect(result.items[0].client).toEqual(ana);
  });

  it("método de outra empresa: 404", async () => {
    prismaMock.paymentMethod.findFirst.mockResolvedValue(null);
    await expect(
      service.report({ paymentMethodId: "m-x" }, "c-1", NOW),
    ).rejects.toThrow(NotFoundException);
    expect(prismaMock.payment.findMany).not.toHaveBeenCalled();
  });
});
