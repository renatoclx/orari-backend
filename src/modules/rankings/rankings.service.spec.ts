import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { periodOf } from "../../common/time/report-period";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyService } from "../company/company.service";
import {
  RankingsService,
  buildRankings,
  type RankedAppointment,
} from "./rankings.service";

const TZ = "America/Sao_Paulo";
const NOW = new Date("2026-11-15T15:00:00.000Z");

const ana = { id: "c-ana", name: "Ana" };
const bia = { id: "c-bia", name: "Bia" };
const camila = { id: "p-camila", name: "Camila" };
const davi = { id: "p-davi", name: "Davi" };
const pilates = { id: "s-pilates", name: "Pilates" };
const massagem = { id: "s-massagem", name: "Massagem" };

const visit = (
  overrides: Partial<RankedAppointment> & { amount: Decimal | null },
): RankedAppointment => ({
  startAt: new Date("2026-11-05T13:00:00Z"),
  client: ana,
  professional: camila,
  service: pilates,
  ...overrides,
});

describe("buildRankings", () => {
  const appointments = [
    visit({ amount: new Decimal(80) }),
    visit({
      amount: new Decimal(80),
      startAt: new Date("2026-11-10T13:00:00Z"),
    }),
    // Sessão de pacote: conta na quantidade, sem valor.
    visit({ amount: null, client: bia }),
    visit({ amount: new Decimal(200), service: massagem, professional: davi }),
  ];
  const contracts = [{ client: bia, amount: new Decimal(500) }];

  it("resumo: faturado dos atendimentos, concluídos, ticket e pacotes", () => {
    expect(buildRankings(appointments, contracts, "amount").summary).toEqual({
      amount: "360.00",
      completed: 4,
      average: "120.00",
      packages: { count: 1, amount: "500.00" },
    });
  });

  it("serviços por faturado, com a parte do total", () => {
    const { services } = buildRankings(appointments, contracts, "amount");
    expect(services).toEqual([
      {
        id: "s-massagem",
        name: "Massagem",
        completed: 1,
        amount: "200.00",
        average: "200.00",
        share: 200 / 360,
      },
      {
        id: "s-pilates",
        name: "Pilates",
        completed: 3,
        amount: "160.00",
        average: "80.00",
        share: 160 / 360,
      },
    ]);
  });

  it("por quantidade, a ordem muda", () => {
    const { services } = buildRankings(appointments, contracts, "count");
    expect(services.map((row) => row.name)).toEqual(["Pilates", "Massagem"]);
  });

  it("profissionais com os clientes atendidos", () => {
    const { professionals } = buildRankings(appointments, contracts, "amount");
    expect(professionals).toEqual([
      {
        id: "p-davi",
        name: "Davi",
        completed: 1,
        amount: "200.00",
        average: "200.00",
        clients: 1,
      },
      {
        id: "p-camila",
        name: "Camila",
        completed: 3,
        amount: "160.00",
        average: "80.00",
        clients: 2,
      },
    ]);
  });

  it("clientes somam os pacotes do período; o ticket é só dos atendimentos", () => {
    const { clients } = buildRankings(appointments, contracts, "amount");
    expect(clients).toEqual([
      {
        id: "c-bia",
        name: "Bia",
        completed: 1,
        amount: "500.00",
        average: null,
        packages: "500.00",
        lastVisit: new Date("2026-11-05T13:00:00Z"),
      },
      {
        id: "c-ana",
        name: "Ana",
        completed: 3,
        amount: "360.00",
        average: "120.00",
        packages: "0.00",
        lastVisit: new Date("2026-11-10T13:00:00Z"),
      },
    ]);
  });

  it("cliente só com pacote entra sem visitas", () => {
    const { clients } = buildRankings(
      [],
      [{ client: bia, amount: new Decimal(300) }],
      "amount",
    );
    expect(clients[0]).toMatchObject({
      id: "c-bia",
      completed: 0,
      amount: "300.00",
      lastVisit: null,
    });
  });
});

describe("RankingsService", () => {
  const prismaMock = {
    appointment: { findMany: vi.fn() },
    clientPlan: { findMany: vi.fn() },
  };
  const companyMock = { getTimeZone: vi.fn() };
  const service = new RankingsService(
    prismaMock as unknown as PrismaService,
    companyMock as unknown as CompanyService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    companyMock.getTimeZone.mockResolvedValue(TZ);
    prismaMock.appointment.findMany.mockResolvedValue([
      // Pagamento cancelado e pagamento excluído não são faturados.
      {
        ...visit({ amount: null }),
        payment: {
          amount: new Decimal(80),
          status: "CANCELLED",
          deletedAt: null,
        },
      },
      {
        ...visit({ amount: null }),
        payment: {
          amount: new Decimal(80),
          status: "PAID",
          deletedAt: new Date(),
        },
      },
      {
        ...visit({ amount: null }),
        payment: {
          amount: new Decimal(50),
          status: "PENDING",
          deletedAt: null,
        },
      },
    ]);
    prismaMock.clientPlan.findMany.mockResolvedValue([
      {
        client: bia,
        payments: [{ amount: new Decimal(100) }, { amount: new Decimal(100) }],
      },
    ]);
  });

  it("só concluídos da empresa no período e pagamentos válidos", async () => {
    const result = await service.rankings({}, "c-1", NOW);
    const november = periodOf(undefined, undefined, TZ, NOW);
    expect(
      (prismaMock.appointment.findMany.mock.calls[0][0] as { where: object })
        .where,
    ).toEqual({
      companyId: "c-1",
      status: "COMPLETED",
      startAt: { gte: november.start, lt: november.end },
    });
    expect(result.summary).toEqual({
      amount: "50.00",
      completed: 3,
      average: "50.00",
      packages: { count: 1, amount: "200.00" },
    });
  });
});
