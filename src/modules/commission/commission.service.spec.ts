import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { NotFoundException } from "@nestjs/common";
import { periodOf } from "../../common/time/report-period";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyService } from "../company/company.service";
import {
  clientPaidFor,
  commissionAmount,
  commissionBase,
  packageSessionValue,
} from "./commission.calculations";
import { CommissionService } from "./commission.service";

const d = (value: number | string) => new Decimal(value);
const paid = (amount: number, status = "PAID", deletedAt: Date | null = null) =>
  ({ amount: d(amount), status, deletedAt }) as never;

describe("contas da comissão", () => {
  it("sessão do pacote: total ÷ sessões geradas, em duas casas", () => {
    expect(packageSessionValue(d(480), 24).toFixed(2)).toBe("20.00");
    expect(packageSessionValue(d(100), 3).toFixed(2)).toBe("33.33");
    expect(packageSessionValue(d(100), 0).toFixed(2)).toBe("0.00");
  });

  it("base: pacote, pagamento ativo ou o preço do serviço", () => {
    expect(
      commissionBase({ payment: null, clientPlanId: "cp" }, d(80), d(20)),
    ).toEqual(d(20));
    expect(
      commissionBase({ payment: paid(70), clientPlanId: null }, d(80), null),
    ).toEqual(d(70));
    // Sem pagamento (avulso a cobrar na comanda) ou com ele cancelado/excluído.
    for (const payment of [
      null,
      paid(70, "CANCELLED"),
      paid(70, "PAID", new Date()),
    ]) {
      expect(
        commissionBase({ payment, clientPlanId: null }, d(80), null),
      ).toEqual(d(80));
    }
    expect(
      commissionBase({ payment: null, clientPlanId: null }, null, null),
    ).toEqual(d(0));
  });

  it("valor: percentual arredondado ou fixo", () => {
    expect(commissionAmount("PERCENT", d(40), d(80)).toFixed(2)).toBe("32.00");
    expect(commissionAmount("PERCENT", d(33.33), d(10)).toFixed(2)).toBe(
      "3.33",
    );
    expect(commissionAmount("PERCENT", d(12.5), d(0.1)).toFixed(2)).toBe(
      "0.01",
    );
    expect(commissionAmount("FIXED", d(15), d(80)).toFixed(2)).toBe("15.00");
  });
});

describe("CommissionService.generatePending", () => {
  const since = new Date("2026-11-10T12:00:00Z");
  const prismaMock = {
    service: { findMany: vi.fn() },
    appointment: { findMany: vi.fn(), count: vi.fn() },
    commission: { createMany: vi.fn() },
  };
  const service = new CommissionService(
    prismaMock as unknown as PrismaService,
    {} as CompanyService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.service.findMany.mockResolvedValue([
      {
        id: "s-1",
        price: d(80),
        commissionType: "PERCENT",
        commissionValue: d(40),
        commissionSince: since,
      },
    ]);
    prismaMock.appointment.count.mockResolvedValue(24);
    prismaMock.commission.createMany.mockImplementation(
      (args: { data: unknown[] }) =>
        Promise.resolve({ count: args.data.length }),
    );
  });

  it("só concluídos, depois do commissionSince e sem comissão", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([]);
    await service.generatePending();
    expect(
      (prismaMock.appointment.findMany.mock.calls[0][0] as { where: object })
        .where,
    ).toEqual({
      serviceId: "s-1",
      status: "COMPLETED",
      endAt: { gte: since },
      commission: { is: null },
    });
    expect(prismaMock.commission.createMany).not.toHaveBeenCalled();
  });

  it("grava base, regra e valor de avulso e de sessão de pacote", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([
      {
        id: "a-1",
        companyId: "c-1",
        professionalId: "p-1",
        payment: paid(70),
        recurringAppointment: null,
      },
      {
        id: "a-2",
        companyId: "c-1",
        professionalId: "p-2",
        payment: null,
        recurringAppointment: {
          clientPlanId: "cp-1",
          clientPlan: { totalAmount: d(480) },
        },
      },
    ]);
    const created = await service.generatePending();

    expect(created).toBe(2);
    type Row = { appointmentId: string; baseAmount: Decimal; amount: Decimal };
    const { data, skipDuplicates } = prismaMock.commission.createMany.mock
      .calls[0][0] as { data: Row[]; skipDuplicates: boolean };
    expect(skipDuplicates).toBe(true);
    expect(
      data.map((row) => [
        row.appointmentId,
        row.baseAmount.toFixed(2),
        row.amount.toFixed(2),
      ]),
    ).toEqual([
      ["a-1", "70.00", "28.00"],
      ["a-2", "20.00", "8.00"],
    ]);
    // A contratação é contada uma vez só.
    expect(prismaMock.appointment.count).toHaveBeenCalledTimes(1);
  });
});

describe("clientPaidFor", () => {
  it("avulso: a base inteira só com o pagamento PAID", () => {
    const base = d(10);
    expect(
      clientPaidFor({ base, payment: paid(10, "PAID"), plan: null }),
    ).toEqual(base);
    expect(
      clientPaidFor({ base, payment: paid(10, "PENDING"), plan: null }).toFixed(
        2,
      ),
    ).toBe("0.00");
    expect(clientPaidFor({ base, payment: null, plan: null }).toFixed(2)).toBe(
      "0.00",
    );
  });

  it("sessão de pacote: na proporção do que a contratação recebeu", () => {
    const base = d(20);
    expect(
      clientPaidFor({
        base,
        payment: null,
        plan: { total: d(480), paid: d(240) },
      }).toFixed(2),
    ).toBe("10.00");
    // Pago a mais (ou tudo) não passa da base.
    expect(
      clientPaidFor({
        base,
        payment: null,
        plan: { total: d(480), paid: d(500) },
      }).toFixed(2),
    ).toBe("20.00");
  });
});

describe("CommissionService: consulta", () => {
  const TZ = "America/Sao_Paulo";
  const NOW = new Date("2026-11-15T15:00:00Z");
  const november = periodOf(undefined, undefined, TZ, NOW);
  const prismaMock = {
    commission: { findMany: vi.fn(), count: vi.fn() },
    people: { findFirst: vi.fn() },
  };
  const service = new CommissionService(
    prismaMock as unknown as PrismaService,
    { getTimeZone: vi.fn().mockResolvedValue(TZ) } as unknown as CompanyService,
  );
  const camila = { id: "p-1", name: "Camila" };
  const davi = { id: "p-2", name: "Davi" };
  const row = (
    professional: { id: string; name: string },
    amount: number,
    payment: unknown,
  ) => ({
    id: `c-${amount}`,
    baseAmount: d(10),
    type: "PERCENT",
    rate: d(40),
    amount: d(amount),
    professional,
    appointment: {
      id: "a",
      startAt: NOW,
      client: { id: "cl", name: "Ana" },
      service: { id: "s", name: "Pilates" },
      payment,
      recurringAppointment: null,
    },
  });

  beforeEach(() => vi.clearAllMocks());

  it("totais e por profissional, só a empresa e o período", async () => {
    prismaMock.commission.findMany.mockResolvedValue([
      row(camila, 4, paid(10, "PAID")),
      row(camila, 4, paid(10, "PENDING")),
      row(davi, 6, paid(10, "PAID")),
    ]);
    const result = await service.summary({}, "co-1", NOW);
    expect(
      (prismaMock.commission.findMany.mock.calls[0][0] as { where: object })
        .where,
    ).toEqual({
      companyId: "co-1",
      professionalId: undefined,
      appointment: { startAt: { gte: november.start, lt: november.end } },
    });
    expect(result).toEqual({
      count: 3,
      base: "30.00",
      amount: "14.00",
      clientPaid: "20.00",
      byProfessional: [
        {
          id: "p-1",
          name: "Camila",
          count: 2,
          base: "20.00",
          amount: "8.00",
          clientPaid: "10.00",
        },
        {
          id: "p-2",
          name: "Davi",
          count: 1,
          base: "10.00",
          amount: "6.00",
          clientPaid: "10.00",
        },
      ],
    });
  });

  it("profissional de outra empresa: 404", async () => {
    prismaMock.people.findFirst.mockResolvedValue(null);
    await expect(
      service.list({ professionalId: "p-x", page: 1, limit: 10 }, "co-1", NOW),
    ).rejects.toThrow(NotFoundException);
    expect(prismaMock.commission.findMany).not.toHaveBeenCalled();
  });
});
