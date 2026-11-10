import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyService } from "../company/company.service";
import { periodOf } from "../../common/time/report-period";
import {
  ClientPortfolioService,
  buildSeries,
  classifyPortfolioClient,
} from "./client-portfolio.service";

const TZ = "America/Sao_Paulo"; // UTC-3
// 15/11/2026, 12:00 em São Paulo.
const NOW = new Date("2026-11-15T15:00:00.000Z");
// Novembro de 2026 no fuso da empresa.
const NOVEMBER = {
  start: new Date("2026-11-01T03:00:00.000Z"),
  end: new Date("2026-12-01T03:00:00.000Z"),
};
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe("buildSeries", () => {
  it("período longo: por semana, a partir do início do período", () => {
    const period = periodOf("2026-08-01", "2026-11-30", TZ, NOW);
    const series = buildSeries(
      // 07/08 às 22h em São Paulo já é dia 08 em UTC: conta no dia da empresa.
      [new Date("2026-08-08T01:00:00Z"), new Date("2026-08-08T03:00:00Z")],
      [],
      period,
      TZ,
    );
    expect(series.unit).toBe("week");
    expect(series.points).toHaveLength(18); // 122 dias
    expect(series.points[0]).toMatchObject({
      date: "2026-08-01",
      completed: 1,
    });
    expect(series.points[1]).toMatchObject({
      date: "2026-08-08",
      completed: 1,
    });
    expect(series.points[17].date).toBe("2026-11-28");
  });

  it("até 62 dias: por dia", () => {
    const period = periodOf("2026-10-01", "2026-12-01", TZ, NOW);
    expect(buildSeries([], [], period, TZ).points).toHaveLength(62);
  });
});

describe("classifyPortfolioClient", () => {
  const none = { firstCompletedAt: null, lastCompletedAt: null, nextAt: null };

  it("Novo: primeiro atendimento concluído no período (vem antes de Ativo)", () => {
    const at = new Date("2026-11-05T13:00:00.000Z");
    expect(
      classifyPortfolioClient(
        { ...none, firstCompletedAt: at, lastCompletedAt: at },
        NOVEMBER,
        NOW,
      ),
    ).toBe("NEW");
  });

  it("Ativo: atendimento concluído nos últimos 60 dias", () => {
    expect(
      classifyPortfolioClient(
        {
          ...none,
          firstCompletedAt: daysAgo(200),
          lastCompletedAt: daysAgo(60),
        },
        NOVEMBER,
        NOW,
      ),
    ).toBe("ACTIVE");
  });

  it("Ativo: só com agendamento futuro", () => {
    expect(
      classifyPortfolioClient(
        { ...none, nextAt: new Date("2026-12-02T13:00:00.000Z") },
        NOVEMBER,
        NOW,
      ),
    ).toBe("ACTIVE");
  });

  it("Sem retorno: último concluído há mais de 60 dias e nada agendado", () => {
    expect(
      classifyPortfolioClient(
        {
          ...none,
          firstCompletedAt: daysAgo(200),
          lastCompletedAt: daysAgo(61),
        },
        NOVEMBER,
        NOW,
      ),
    ).toBe("LAPSED");
  });

  it("Sem retorno: nunca concluiu e não tem agendamento futuro", () => {
    expect(classifyPortfolioClient(none, NOVEMBER, NOW)).toBe("LAPSED");
  });
});

describe("ClientPortfolioService", () => {
  const prismaMock = {
    people: { findFirst: vi.fn(), findMany: vi.fn() },
    appointment: { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    payment: { findMany: vi.fn() },
  };
  const companyMock = { getTimeZone: vi.fn() };
  const service = new ClientPortfolioService(
    prismaMock as unknown as PrismaService,
    companyMock as unknown as CompanyService,
  );
  const query = { professionalId: "prof-1", page: 1, limit: 10 };

  // Ana: nova (1ª vez em novembro). Bia: sem retorno. Caio: só agendamento futuro.
  // Duda: ativa, com pendência.
  beforeEach(() => {
    vi.clearAllMocks();
    companyMock.getTimeZone.mockResolvedValue(TZ);
    prismaMock.people.findFirst.mockResolvedValue({ id: "prof-1" });
    prismaMock.appointment.groupBy.mockImplementation(
      ({ _min, _count }: { _min?: object; _count?: object }) => {
        if (_min) {
          return [
            {
              clientId: "ana",
              _min: { startAt: new Date("2026-11-05T13:00:00Z") },
            },
            { clientId: "bia", _min: { startAt: daysAgo(300) } },
            { clientId: "duda", _min: { startAt: daysAgo(100) } },
          ];
        }
        if (_count) return [{ clientId: "ana", _count: { _all: 2 } }];
        return ["ana", "bia", "caio", "duda"].map((clientId) => ({ clientId }));
      },
    );
    prismaMock.appointment.findMany.mockImplementation(
      ({ select }: { select: { service?: object; clientId?: boolean } }) => {
        // Concluídos do período (resumo): só o início.
        if (!select.clientId) {
          return [
            new Date("2026-11-03T13:00:00Z"),
            new Date("2026-11-05T13:00:00Z"),
            new Date("2026-11-05T18:00:00Z"),
          ].map((startAt) => ({ startAt }));
        }
        return select.service
          ? [
              {
                clientId: "ana",
                startAt: new Date("2026-11-12T13:00:00Z"),
                service: { name: "Pilates" },
              },
              {
                clientId: "bia",
                startAt: daysAgo(90),
                service: { name: "Yoga" },
              },
              {
                clientId: "duda",
                startAt: daysAgo(10),
                service: { name: "Pilates" },
              },
            ]
          : [{ clientId: "caio", startAt: new Date("2026-11-20T13:00:00Z") }];
      },
    );
    prismaMock.payment.findMany.mockImplementation(
      ({ select }: { select: { status?: boolean } }) =>
        !select.status
          ? [
              { amount: new Decimal("80"), appointment: { clientId: "duda" } },
              {
                amount: new Decimal("20.5"),
                appointment: { clientId: "duda" },
              },
            ]
          : [
              {
                amount: new Decimal("100"),
                status: "PAID",
                appointment: { startAt: new Date("2026-11-03T13:00:00Z") },
              },
              {
                amount: new Decimal("50"),
                status: "PENDING",
                appointment: { startAt: new Date("2026-11-05T13:00:00Z") },
              },
            ],
    );
    prismaMock.people.findMany.mockResolvedValue(
      ["ana", "bia", "caio", "duda"].map((id) => ({
        id,
        name: id[0].toUpperCase() + id.slice(1),
        photoUrl: null,
        contacts: id === "caio" ? [] : [{ phone: "11999990000" }],
      })),
    );
    prismaMock.appointment.count.mockResolvedValue(1); // sessões de pacote
  });

  it("profissional de outra empresa (ou que não é profissional): 404", async () => {
    prismaMock.people.findFirst.mockResolvedValue(null);
    await expect(service.summary(query, "c-1", NOW)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("cancelados ficam fora da carteira", async () => {
    await service.clients(query, "c-1", NOW);
    expect(
      (prismaMock.appointment.groupBy.mock.calls[0][0] as { where: object })
        .where,
    ).toMatchObject({
      companyId: "c-1",
      professionalId: "prof-1",
      status: { not: "CANCELLED" },
      client: { deletedAt: null },
    });
  });

  it("resumo: contagens, valores dos concluídos e ticket médio", async () => {
    await expect(service.summary(query, "c-1", NOW)).resolves.toMatchObject({
      clients: 4,
      newClients: 1,
      lapsedClients: 1,
      completed: 3,
      packageSessions: 1,
      received: "100.00",
      pending: "50.00",
      averageTicket: "75.00",
    });
  });

  it("resumo: série por dia do período, com os dias vazios", async () => {
    const { series } = await service.summary(query, "c-1", NOW);
    expect(series.unit).toBe("day");
    expect(series.points).toHaveLength(30);
    expect(series.points[2]).toEqual({
      date: "2026-11-03",
      completed: 1,
      received: "100.00",
      pending: "0.00",
    });
    expect(series.points[4]).toEqual({
      date: "2026-11-05",
      completed: 2,
      received: "0.00",
      pending: "50.00",
    });
    expect(series.points[0]).toMatchObject({ completed: 0, received: "0.00" });
  });

  it("resumo sem pagamento: ticket médio nulo", async () => {
    prismaMock.payment.findMany.mockResolvedValue([]);
    const summary = await service.summary(query, "c-1", NOW);
    expect(summary.averageTicket).toBeNull();
    expect(summary.received).toBe("0.00");
  });

  it("lista: quem precisa de contato primeiro; só agendamento futuro no fim", async () => {
    const result = await service.clients(query, "c-1", NOW);
    expect(result.items.map((c) => [c.id, c.status])).toEqual([
      ["bia", "LAPSED"],
      ["duda", "ACTIVE"],
      ["ana", "NEW"],
      ["caio", "ACTIVE"],
    ]);
    expect(result.total).toBe(4);
    const duda = result.items[1];
    expect(duda.pending).toBe("100.50");
    expect(duda.lastCompleted?.serviceName).toBe("Pilates");
    expect(result.items[2].completedInPeriod).toBe(2);
    expect(result.items[3]).toMatchObject({ phone: null, lastCompleted: null });
  });

  it("lista: filtra por situação e por nome (sem acento)", async () => {
    const lapsed = await service.clients(
      { ...query, status: "LAPSED" },
      "c-1",
      NOW,
    );
    expect(lapsed.items.map((c) => c.id)).toEqual(["bia"]);

    const byName = await service.clients(
      { ...query, search: "DÚDA" },
      "c-1",
      NOW,
    );
    expect(byName.items.map((c) => c.id)).toEqual(["duda"]);
  });

  it("lista: paginação", async () => {
    const result = await service.clients(
      { ...query, page: 2, limit: 3 },
      "c-1",
      NOW,
    );
    expect(result.items.map((c) => c.id)).toEqual(["caio"]);
    expect(result).toMatchObject({ total: 4, page: 2, limit: 3 });
  });
});
