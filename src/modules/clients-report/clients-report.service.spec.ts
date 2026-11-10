import { beforeEach, describe, expect, it, vi } from "vitest";
import { periodOf } from "../../common/time/report-period";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyService } from "../company/company.service";
import {
  ClientsReportService,
  ageOn,
  birthdayIn,
  kindsOf,
  periodDays,
  summarizeClients,
  type ReportClient,
} from "./clients-report.service";

const TZ = "America/Sao_Paulo";
const NOW = new Date("2026-11-15T15:00:00.000Z");
const TODAY = "2026-11-15";
const NOVEMBER = periodOf(undefined, undefined, TZ, NOW);

const client = (
  id: string,
  overrides: Partial<ReportClient> = {},
): ReportClient => ({
  id,
  birthDate: null,
  hasApp: false,
  city: null,
  firstCompleted: null,
  lastCompleted: null,
  hasUpcoming: false,
  ...overrides,
});

describe("ageOn", () => {
  it("anos completos: antes e no dia do aniversário", () => {
    const birth = new Date("1990-11-20T00:00:00Z");
    expect(ageOn(birth, "2026-11-19")).toBe(35);
    expect(ageOn(birth, "2026-11-20")).toBe(36);
  });
});

describe("birthdayIn", () => {
  const november = periodDays(NOVEMBER, TZ);

  it("aniversário dentro e fora do período", () => {
    expect(november).toHaveLength(30);
    expect(birthdayIn(new Date("1990-11-20T00:00:00Z"), november)).toBe(
      "2026-11-20",
    );
    expect(birthdayIn(new Date("1990-12-01T00:00:00Z"), november)).toBeNull();
  });

  it("29/02 comemora em 28/02 no ano não bissexto", () => {
    const february = periodDays(
      periodOf("2027-02-01", "2027-02-28", TZ, NOW),
      TZ,
    );
    expect(birthdayIn(new Date("2000-02-29T00:00:00Z"), february)).toBe(
      "2027-02-28",
    );
  });

  it("período de mais de um ano: a primeira ocorrência", () => {
    const days = periodDays(periodOf("2026-01-01", "2027-12-31", TZ, NOW), TZ);
    expect(days).toHaveLength(366);
    expect(birthdayIn(new Date("1990-03-10T00:00:00Z"), days)).toBe(
      "2026-03-10",
    );
  });
});

describe("kindsOf", () => {
  it("pacote numa turma conta nos dois; sem nada, avulso", () => {
    expect(
      kindsOf({
        classSessionId: "s",
        recurringAppointmentId: "r",
        recurringAppointment: { clientPlanId: "cp" },
      }),
    ).toEqual(["package", "class"]);
    expect(
      kindsOf({
        classSessionId: null,
        recurringAppointmentId: "r",
        recurringAppointment: { clientPlanId: null },
      }),
    ).toEqual(["recurrence"]);
    expect(
      kindsOf({
        classSessionId: null,
        recurringAppointmentId: null,
        recurringAppointment: null,
      }),
    ).toEqual(["single"]);
  });
});

describe("summarizeClients", () => {
  const clients = [
    // Novo em novembro, com app e em São Paulo.
    client("a", {
      firstCompleted: new Date("2026-11-03T13:00:00Z"),
      lastCompleted: new Date("2026-11-10T13:00:00Z"),
      hasApp: true,
      city: "São Paulo/SP",
      birthDate: new Date("1990-01-01T00:00:00Z"),
    }),
    // Antigo, só com agendamento futuro: ativo.
    client("b", {
      firstCompleted: new Date("2025-01-10T13:00:00Z"),
      lastCompleted: new Date("2025-06-10T13:00:00Z"),
      hasUpcoming: true,
      city: "São Paulo/SP",
      birthDate: new Date("2010-05-05T00:00:00Z"),
    }),
    // Último concluído há mais de 60 dias: sem retorno.
    client("c", {
      firstCompleted: new Date("2026-01-10T13:00:00Z"),
      lastCompleted: new Date("2026-09-01T13:00:00Z"),
      city: "Campinas/SP",
    }),
    // Nunca atendido: sem retorno.
    client("d"),
  ];
  const attendances = [
    { clientId: "a", source: "PORTAL" as const, kinds: ["single" as const] },
    {
      clientId: "a",
      source: "CLINIC" as const,
      kinds: ["package" as const, "class" as const],
    },
    {
      clientId: "c",
      source: "CLINIC" as const,
      kinds: ["recurrence" as const],
    },
    // Cliente inativado: fora do perfil.
    { clientId: "x", source: "CLINIC" as const, kinds: ["single" as const] },
  ];
  const report = summarizeClients(clients, attendances, NOVEMBER, TODAY, NOW);

  it("base, ativos, novos, sem retorno e frequência", () => {
    expect(report).toMatchObject({
      clients: 4,
      active: 2,
      newClients: 1,
      lapsed: 2,
      attended: 2,
      frequency: 1.5,
    });
  });

  it("tipos sobre os atendidos; origem sobre os concluídos", () => {
    expect(report.kinds).toEqual({
      single: { count: 1, share: 0.5 },
      recurrence: { count: 1, share: 0.5 },
      package: { count: 1, share: 0.5 },
      class: { count: 1, share: 0.5 },
    });
    expect(report.sources).toEqual({
      clinic: { count: 2, share: 2 / 3 },
      portal: { count: 1, share: 1 / 3 },
    });
    expect(report.withApp).toEqual({ count: 1, share: 0.25 });
  });

  it("faixas de idade e cidades, com o não informado", () => {
    expect(report.ages.map((age) => [age.key, age.count])).toEqual([
      ["0-17", 1],
      ["18-29", 0],
      ["30-44", 1],
      ["45-59", 0],
      ["60+", 0],
      [null, 2],
    ]);
    expect(report.cities).toEqual([
      { name: "São Paulo/SP", count: 2, share: 0.5 },
      { name: "Campinas/SP", count: 1, share: 0.25 },
      { name: null, count: 1, share: 0.25 },
    ]);
  });
});

describe("ClientsReportService.birthdays", () => {
  const prismaMock = { people: { findMany: vi.fn() } };
  const companyMock = { getTimeZone: vi.fn() };
  const service = new ClientsReportService(
    prismaMock as unknown as PrismaService,
    companyMock as unknown as CompanyService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    companyMock.getTimeZone.mockResolvedValue(TZ);
  });

  it("do período, pela data do aniversário, com a idade que completa", async () => {
    const person = (id: string, name: string, birthDate: string) => ({
      id,
      name,
      photoUrl: null,
      birthDate: new Date(`${birthDate}T00:00:00Z`),
      contacts: [],
    });
    prismaMock.people.findMany.mockResolvedValue([
      person("a", "Bia", "1990-11-20"),
      person("b", "Ana", "2000-11-02"),
      person("c", "Caio", "1985-12-01"),
    ]);
    const result = await service.birthdays({ page: 1, limit: 10 }, "co-1", NOW);
    expect(result.total).toBe(2);
    expect(
      result.items.map((item) => [item.name, item.birthday, item.turning]),
    ).toEqual([
      ["Ana", "2026-11-02", 26],
      ["Bia", "2026-11-20", 36],
    ]);
  });
});
