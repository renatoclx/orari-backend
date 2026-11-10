import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { periodOf } from "../../common/time/report-period";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyService } from "../company/company.service";
import {
  PackagesReportService,
  endingContracts,
  summarizePackages,
  type ReportContract,
} from "./packages-report.service";

const TZ = "America/Sao_Paulo";
const NOW = new Date("2026-11-15T15:00:00.000Z");
const NOVEMBER = periodOf(undefined, undefined, TZ, NOW);
const TODAY = new Date("2026-11-15T00:00:00Z");

const mensal = { id: "pl-mensal", name: "Pilates Mensal" };
const turma = { id: "pl-turma", name: "Turma 6 meses" };

const contract = (
  id: string,
  overrides: Partial<ReportContract> = {},
): ReportContract => ({
  id,
  clientId: `c-${id}`,
  plan: mensal,
  totalAmount: new Decimal(480),
  endDate: new Date("2027-05-10T00:00:00Z"),
  createdAt: new Date("2026-11-05T13:00:00Z"),
  cancelledAt: null,
  ...overrides,
});

describe("endingContracts", () => {
  it("ativas que terminam em até 30 dias e sem renovação, do fim mais próximo", () => {
    const rows = [
      contract("a", { endDate: new Date("2026-12-10T00:00:00Z") }),
      contract("b", { endDate: new Date("2026-11-20T00:00:00Z") }),
      // Fora da janela (31 dias depois de hoje).
      contract("c", { endDate: new Date("2026-12-16T00:00:00Z") }),
      // Já terminou ontem.
      contract("d", { endDate: new Date("2026-11-14T00:00:00Z") }),
      // Cancelada.
      contract("e", {
        endDate: new Date("2026-11-30T00:00:00Z"),
        cancelledAt: new Date("2026-11-10T13:00:00Z"),
      }),
      // Renovada: o mesmo cliente tem outra ativa terminando depois.
      contract("f", { endDate: new Date("2026-11-25T00:00:00Z") }),
      contract("g", { clientId: "c-f" }),
    ];
    expect(endingContracts(rows, TODAY).map((row) => row.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("termina hoje: ainda entra", () => {
    expect(
      endingContracts([contract("a", { endDate: TODAY })], TODAY),
    ).toHaveLength(1);
  });
});

describe("summarizePackages", () => {
  const rows = [
    contract("a"),
    contract("b", { plan: turma, totalAmount: new Decimal(432) }),
    // Contratada em outubro, cancelada em novembro.
    contract("c", {
      createdAt: new Date("2026-10-01T13:00:00Z"),
      cancelledAt: new Date("2026-11-03T13:00:00Z"),
    }),
    // Contratada em outubro, ainda ativa e terminando.
    contract("d", {
      createdAt: new Date("2026-10-01T13:00:00Z"),
      endDate: new Date("2026-11-30T00:00:00Z"),
    }),
  ];
  const report = summarizePackages(rows, NOVEMBER, TODAY);

  it("totais", () => {
    expect(report).toMatchObject({
      created: { count: 2, amount: "912.00" },
      active: 3,
      cancelled: 1,
      ending: 1,
    });
  });

  it("por pacote, do maior valor contratado", () => {
    expect(report.byPlan).toEqual([
      {
        id: "pl-mensal",
        name: "Pilates Mensal",
        created: 1,
        amount: "480.00",
        active: 2,
        cancelled: 1,
      },
      {
        id: "pl-turma",
        name: "Turma 6 meses",
        created: 1,
        amount: "432.00",
        active: 1,
        cancelled: 0,
      },
    ]);
  });
});

describe("PackagesReportService.ending", () => {
  const prismaMock = {
    clientPlan: { findMany: vi.fn() },
    appointment: { findMany: vi.fn() },
  };
  const companyMock = { getTimeZone: vi.fn() };
  const service = new PackagesReportService(
    prismaMock as unknown as PrismaService,
    companyMock as unknown as CompanyService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    companyMock.getTimeZone.mockResolvedValue(TZ);
  });

  it("sessões concluídas de total e o celular principal", async () => {
    prismaMock.clientPlan.findMany.mockResolvedValue([
      {
        ...contract("a", { endDate: new Date("2026-11-30T00:00:00Z") }),
        client: {
          id: "c-a",
          name: "Ana",
          photoUrl: null,
          contacts: [{ phone: "11999990000" }],
        },
      },
    ]);
    prismaMock.appointment.findMany.mockResolvedValue([
      { status: "COMPLETED", recurringAppointment: { clientPlanId: "a" } },
      { status: "COMPLETED", recurringAppointment: { clientPlanId: "a" } },
      { status: "SCHEDULED", recurringAppointment: { clientPlanId: "a" } },
    ]);

    const result = await service.ending({ page: 1, limit: 10 }, "co-1", NOW);
    expect(
      (prismaMock.clientPlan.findMany.mock.calls[0][0] as { where: object })
        .where,
    ).toEqual({
      companyId: "co-1",
      cancelledAt: null,
      endDate: { gte: TODAY },
    });
    expect(result).toEqual({
      items: [
        {
          id: "a",
          client: {
            id: "c-a",
            name: "Ana",
            photoUrl: null,
            phone: "11999990000",
          },
          plan: mensal,
          endDate: "2026-11-30",
          sessions: { completed: 2, total: 3 },
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
    });
  });

  it("sem nenhuma terminando: não busca sessões", async () => {
    prismaMock.clientPlan.findMany.mockResolvedValue([]);
    const result = await service.ending({ page: 1, limit: 10 }, "co-1", NOW);
    expect(result.total).toBe(0);
    expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
  });
});
