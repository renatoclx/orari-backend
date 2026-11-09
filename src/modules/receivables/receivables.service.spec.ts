import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyService } from "../company/company.service";
import {
  ReceivablesService,
  agingOf,
  localToday,
  monthlySeries,
} from "./receivables.service";

const TZ = "America/Sao_Paulo"; // UTC-3
// 15/11/2026, 22:00 em São Paulo (já é dia 16 em UTC).
const NOW = new Date("2026-11-16T01:00:00.000Z");
const TODAY = new Date(Date.UTC(2026, 10, 15));
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("localToday", () => {
  it("usa o calendário da empresa, não o UTC", () => {
    expect(localToday(NOW, TZ)).toEqual(TODAY);
  });
});

describe("agingOf", () => {
  it("separa o atraso em faixas de dias, com as vazias", () => {
    const aging = agingOf(
      [
        { amount: new Decimal(10), dueDate: day("2026-11-14") }, // 1 dia
        { amount: new Decimal(20), dueDate: day("2026-10-16") }, // 30 dias
        { amount: new Decimal(30), dueDate: day("2026-10-15") }, // 31 dias
        { amount: new Decimal(40), dueDate: day("2026-08-01") }, // 106 dias
      ],
      TODAY,
    );
    expect(aging).toEqual([
      { key: "1-30", total: "30.00", count: 2 },
      { key: "31-60", total: "30.00", count: 1 },
      { key: "61-90", total: "0.00", count: 0 },
      { key: "90+", total: "40.00", count: 1 },
    ]);
  });
});

describe("monthlySeries", () => {
  it("9 meses pelo vencimento: pago, atrasado e a vencer", () => {
    const series = monthlySeries(
      [
        {
          amount: new Decimal(100),
          status: "PAID",
          dueDate: day("2026-06-10"),
        },
        {
          amount: new Decimal(50),
          status: "PENDING",
          dueDate: day("2026-11-14"),
        },
        {
          amount: new Decimal(70),
          status: "PENDING",
          dueDate: day("2026-11-15"),
        },
        {
          amount: new Decimal(9),
          status: "PENDING",
          dueDate: day("2027-03-01"),
        }, // fora
      ],
      TODAY,
    );
    expect(series.map((point) => point.month)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
    expect(series[0]).toEqual({
      month: "2026-06",
      paid: "100.00",
      overdue: "0.00",
      upcoming: "0.00",
    });
    // Vence hoje ainda não está atrasado.
    expect(series[5]).toEqual({
      month: "2026-11",
      paid: "0.00",
      overdue: "50.00",
      upcoming: "70.00",
    });
  });
});

type Row = {
  amount: Decimal;
  status: "PAID" | "PENDING" | "CANCELLED";
  dueDate: Date | null;
  paidAt: Date | null;
  clientId: string;
  fromPlan?: boolean;
};

type Range = { gte?: Date; lt?: Date };
type Where = {
  status: string | { in: string[] };
  dueDate?: Range;
  paidAt?: Range;
};

const inRange = (value: Date | null, range?: Range) =>
  !range ||
  (value !== null &&
    (!range.gte || value >= range.gte) &&
    (!range.lt || value < range.lt));

describe("ReceivablesService", () => {
  const client = (id: string) => ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    photoUrl: null,
    contacts: id === "caio" ? [] : [{ phone: "11999990000" }],
  });
  // Ana deve 2 atrasados; Bia, 1 atrasado de contratação; Caio só a vencer.
  const rows: Row[] = [
    {
      amount: new Decimal(80),
      status: "PENDING",
      dueDate: day("2026-11-10"),
      paidAt: null,
      clientId: "ana",
    },
    {
      amount: new Decimal(20),
      status: "PENDING",
      dueDate: day("2026-09-01"),
      paidAt: null,
      clientId: "ana",
    },
    {
      amount: new Decimal(150),
      status: "PENDING",
      dueDate: day("2026-11-01"),
      paidAt: null,
      clientId: "bia",
      fromPlan: true,
    },
    {
      amount: new Decimal(60),
      status: "PENDING",
      dueDate: day("2026-11-20"),
      paidAt: null,
      clientId: "caio",
    },
    {
      amount: new Decimal(40),
      status: "PENDING",
      dueDate: null,
      paidAt: null,
      clientId: "caio",
    },
    {
      amount: new Decimal(250),
      status: "PAID",
      dueDate: day("2026-11-05"),
      paidAt: new Date("2026-11-05T15:00:00Z"),
      clientId: "caio",
    },
    {
      amount: new Decimal(999),
      status: "CANCELLED",
      dueDate: day("2026-11-03"),
      paidAt: null,
      clientId: "ana",
    },
  ];

  // Banco de mentira: aplica só os filtros que o serviço usa.
  const findMany = vi.fn(({ where }: { where: Where }) =>
    rows
      .filter((row) =>
        typeof where.status === "string"
          ? row.status === where.status
          : where.status.in.includes(row.status),
      )
      .filter((row) => inRange(row.dueDate, where.dueDate))
      .filter((row) => inRange(row.paidAt, where.paidAt))
      .sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0))
      .map((row) => ({
        amount: row.amount,
        status: row.status,
        dueDate: row.dueDate,
        appointment: row.fromPlan
          ? null
          : { clientId: row.clientId, client: client(row.clientId) },
        clientPlan: row.fromPlan
          ? { clientId: row.clientId, client: client(row.clientId) }
          : null,
      })),
  );
  const prismaMock = { payment: { findMany } };
  const companyMock = { getTimeZone: vi.fn() };
  const service = new ReceivablesService(
    prismaMock as unknown as PrismaService,
    companyMock as unknown as CompanyService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    companyMock.getTimeZone.mockResolvedValue(TZ);
  });

  it("só pagamentos da empresa e não excluídos", async () => {
    await service.summary({}, "c-1", NOW);
    for (const [args] of findMany.mock.calls) {
      expect(args.where).toMatchObject({ companyId: "c-1", deletedAt: null });
    }
  });

  it("resumo: em aberto, atrasado, recebido e inadimplência do mês", async () => {
    await expect(service.summary({}, "c-1", NOW)).resolves.toMatchObject({
      open: { total: "350.00", count: 5 },
      overdue: { total: "250.00", count: 3, clients: 2 },
      received: { total: "250.00", count: 1 },
      // Venceu de 01/11 a 14/11: 80 + 150 + 250 (pago); pendentes: 230.
      default: { due: "480.00", unpaid: "230.00", rate: 230 / 480 },
    });
  });

  it("período só no futuro: inadimplência sem base (null)", async () => {
    const { default: rate } = await service.summary(
      { from: "2026-12-01", to: "2026-12-31" },
      "c-1",
      NOW,
    );
    expect(rate).toEqual({ due: "0.00", unpaid: "0.00", rate: null });
  });

  it("recusa período com fim antes do início", async () => {
    await expect(
      service.summary({ from: "2026-11-10", to: "2026-11-01" }, "c-1", NOW),
    ).rejects.toThrow(BadRequestException);
  });

  it("devedores: um por cliente, maior atraso primeiro, vencimento mais antigo", async () => {
    await expect(
      service.debtors({ page: 1, limit: 10 }, "c-1", NOW),
    ).resolves.toEqual({
      items: [
        {
          id: "bia",
          name: "Bia",
          photoUrl: null,
          phone: "11999990000",
          overdue: "150.00",
          count: 1,
          oldestDueDate: "2026-11-01",
        },
        {
          id: "ana",
          name: "Ana",
          photoUrl: null,
          phone: "11999990000",
          overdue: "100.00",
          count: 2,
          oldestDueDate: "2026-09-01",
        },
      ],
      total: 2,
      page: 1,
      limit: 10,
    });
  });

  it("devedores: busca pelo nome sem acento e caixa", async () => {
    const result = await service.debtors(
      { search: "ÁNA", page: 1, limit: 10 },
      "c-1",
      NOW,
    );
    expect(result.items.map((item) => item.id)).toEqual(["ana"]);
  });
});
