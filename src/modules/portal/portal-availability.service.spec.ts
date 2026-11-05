import { BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import { PortalAvailabilityService } from "./portal-availability.service";
import type { PortalCompany } from "./portal-company.service";

// Fuso de São Paulo (UTC-3, sem horário de verão): 09:00 local = 12:00Z.
const company: PortalCompany = {
  id: "c-1",
  name: "Studio Aurora",
  logoUrl: null,
  segment: null,
  timezone: "America/Sao_Paulo",
  rules: { minAdvanceMinutes: 60, maxDaysAhead: 30, cancelUntilHours: 24 },
};
// "Agora": 04/11/2026 às 10:00 em São Paulo.
const NOW = new Date("2026-11-04T13:00:00.000Z");
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

describe("PortalAvailabilityService", () => {
  const prismaMock = {
    serviceProfessional: { findFirst: vi.fn() },
    businessHour: { findMany: vi.fn() },
    appointment: { findMany: vi.fn() },
    classGroupDay: { findMany: vi.fn() },
  };
  const service = new PortalAvailabilityService(
    prismaMock as unknown as PrismaService,
  );
  const find = (date: string) =>
    service.findSlots(company, "s-1", "p-1", date, NOW);

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.serviceProfessional.findFirst.mockResolvedValue({
      service: { duration: 60 },
    });
    prismaMock.businessHour.findMany.mockResolvedValue([
      { openAt: time("09:00"), closeAt: time("12:00") },
    ]);
    prismaMock.appointment.findMany.mockResolvedValue([]);
    prismaMock.classGroupDay.findMany.mockResolvedValue([]);
  });

  it("devolve o horário local e o instante em UTC", async () => {
    const slots = await find("2026-11-05");
    expect(slots[0]).toEqual({
      time: "09:00",
      startAt: "2026-11-05T12:00:00.000Z",
    });
    expect(slots.map((s) => s.time)).toContain("11:00");
  });

  it("hoje: só a partir de agora + antecedência mínima (10:00 + 1 h)", async () => {
    const slots = await find("2026-11-04");
    expect(slots.map((s) => s.time)).toEqual(["11:00"]);
  });

  it("agendamentos não cancelados e turmas do profissional bloqueiam", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([
      // 09:00–10:00 local
      {
        startAt: new Date("2026-11-05T12:00:00Z"),
        endAt: new Date("2026-11-05T13:00:00Z"),
      },
    ]);
    prismaMock.classGroupDay.findMany.mockResolvedValue([
      { startTime: time("11:00"), classGroup: { service: { duration: 60 } } },
    ]);

    const slots = (await find("2026-11-05")).map((s) => s.time);

    expect(slots).toEqual(["10:00"]);
    expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          professionalId: "p-1",
          status: { not: "CANCELLED" },
        }) as object,
      }),
    );
  });

  it.each([
    ["no passado", "2026-11-03"],
    ["além dos dias à frente", "2026-12-05"],
  ])("data %s: lista vazia, sem consultar a agenda", async (_, date) => {
    await expect(find(date)).resolves.toEqual([]);
    expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
  });

  it("no limite dos dias à frente ainda vale", async () => {
    await expect(find("2026-12-04")).resolves.not.toEqual([]);
  });

  it("data impossível: 400", async () => {
    await expect(find("2026-02-30")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("serviço sem esse profissional ligado (ou inativo): 404", async () => {
    prismaMock.serviceProfessional.findFirst.mockResolvedValue(null);
    await expect(find("2026-11-05")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("sem horário de funcionamento no dia: nenhum horário", async () => {
    prismaMock.businessHour.findMany.mockResolvedValue([]);
    await expect(find("2026-11-05")).resolves.toEqual([]);
  });
});
