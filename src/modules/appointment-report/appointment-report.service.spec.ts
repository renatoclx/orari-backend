import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { periodOf } from "../../common/time/report-period";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyService } from "../company/company.service";
import {
  AppointmentReportService,
  summarizeAppointments,
  type ReportAppointment,
} from "./appointment-report.service";

const TZ = "America/Sao_Paulo"; // UTC-3
const NOW = new Date("2026-11-15T15:00:00.000Z");
const NOVEMBER = periodOf(undefined, undefined, TZ, NOW);

const ana = { id: "p-ana", name: "Ana" };
const bia = { id: "p-bia", name: "Bia" };
const pilates = { id: "s-pilates", name: "Pilates" };
const yoga = { id: "s-yoga", name: "Yoga" };

// Começo em UTC; 50 min de duração.
const at = (
  startAt: string,
  status: ReportAppointment["status"],
  overrides: Partial<ReportAppointment> = {},
): ReportAppointment => ({
  status,
  startAt: new Date(startAt),
  endAt: new Date(new Date(startAt).getTime() + 50 * 60 * 1000),
  source: "CLINIC",
  professional: ana,
  service: pilates,
  ...overrides,
});

describe("summarizeAppointments", () => {
  const rows = [
    // Segunda 02/11, 09h local (12h UTC).
    at("2026-11-02T12:00:00Z", "COMPLETED"),
    at("2026-11-02T12:00:00Z", "COMPLETED", { source: "PORTAL" }),
    at("2026-11-02T13:00:00Z", "NO_SHOW", { professional: bia }),
    at("2026-11-03T12:00:00Z", "CANCELLED", { service: yoga }),
    // Quinta 05/11, 22h local (06/11 01h UTC): conta no dia 05.
    at("2026-11-06T01:00:00Z", "CONFIRMED", {
      professional: bia,
      service: yoga,
    }),
  ];
  const report = summarizeAppointments(rows, NOVEMBER, TZ);

  it("contagens e taxas (cancelado fora do total)", () => {
    expect(report).toMatchObject({
      total: 4,
      open: 1,
      completed: 2,
      noShow: 1,
      cancelled: 1,
      fromPortal: 1,
      noShowRate: 1 / 3,
      cancelRate: 1 / 5,
    });
  });

  it("série por dia, no dia da empresa", () => {
    expect(report.series.unit).toBe("day");
    expect(report.series.points).toHaveLength(30);
    expect(report.series.points[1]).toEqual({
      date: "2026-11-02",
      completed: 2,
      noShow: 1,
      cancelled: 0,
      open: 0,
    });
    expect(report.series.points[4]).toMatchObject({
      date: "2026-11-05",
      open: 1,
    });
  });

  it("pico por dia da semana e hora local, sem os cancelados", () => {
    expect(report.peak).toEqual([
      { weekDay: 1, hour: 9, count: 2 },
      { weekDay: 1, hour: 10, count: 1 },
      { weekDay: 4, hour: 22, count: 1 },
    ]);
  });

  it("por profissional e por serviço, do maior total para o menor", () => {
    expect(report.byProfessional).toEqual([
      {
        id: "p-ana",
        name: "Ana",
        total: 2,
        completed: 2,
        noShow: 0,
        cancelled: 1,
      },
      {
        id: "p-bia",
        name: "Bia",
        total: 2,
        completed: 0,
        noShow: 1,
        cancelled: 0,
      },
    ]);
    expect(report.byService).toEqual([
      {
        id: "s-pilates",
        name: "Pilates",
        total: 3,
        completed: 2,
        noShow: 1,
        cancelled: 0,
        minutes: 150,
      },
      {
        id: "s-yoga",
        name: "Yoga",
        total: 1,
        completed: 0,
        noShow: 0,
        cancelled: 1,
        minutes: 50,
      },
    ]);
  });

  it("sem agendamentos: taxas null", () => {
    expect(summarizeAppointments([], NOVEMBER, TZ)).toMatchObject({
      total: 0,
      noShowRate: null,
      cancelRate: null,
      peak: [],
    });
  });
});

describe("AppointmentReportService", () => {
  const prismaMock = {
    people: { findFirst: vi.fn() },
    appointment: { findMany: vi.fn() },
  };
  const companyMock = { getTimeZone: vi.fn() };
  const service = new AppointmentReportService(
    prismaMock as unknown as PrismaService,
    companyMock as unknown as CompanyService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    companyMock.getTimeZone.mockResolvedValue(TZ);
    prismaMock.appointment.findMany.mockResolvedValue([]);
  });

  it("só a empresa e o período; sem profissional, todos", async () => {
    await service.report({}, "c-1", NOW);
    expect(prismaMock.people.findFirst).not.toHaveBeenCalled();
    expect(
      (prismaMock.appointment.findMany.mock.calls[0][0] as { where: object })
        .where,
    ).toEqual({
      companyId: "c-1",
      professionalId: undefined,
      startAt: { gte: NOVEMBER.start, lt: NOVEMBER.end },
    });
  });

  it("profissional de outra empresa: 404", async () => {
    prismaMock.people.findFirst.mockResolvedValue(null);
    await expect(
      service.report({ professionalId: "p-x" }, "c-1", NOW),
    ).rejects.toThrow(NotFoundException);
    expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
  });
});
