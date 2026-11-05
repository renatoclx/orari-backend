import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { AppointmentService } from "../appointment/appointment.service";
import type { PortalAvailabilityService } from "./portal-availability.service";
import { PortalAppointmentService } from "./portal-appointment.service";
import type { PortalCompany } from "./portal-company.service";

const company: PortalCompany = {
  id: "c-1",
  name: "Studio Aurora",
  logoUrl: null,
  timezone: "America/Sao_Paulo",
  rules: { minAdvanceMinutes: 60, maxDaysAhead: 30, cancelUntilHours: 24 },
};
const client = {
  sessionId: "s-1",
  accountId: "acc-1",
  companyId: "c-1",
  peopleId: "cli-1",
};
const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000);

const item = (overrides: object = {}) => ({
  id: "a-1",
  startAt: inHours(48),
  endAt: inHours(49),
  status: "SCHEDULED",
  source: "PORTAL",
  recurringAppointmentId: null,
  classSessionId: null,
  recurringAppointment: null,
  service: { name: "Corte", duration: 60 },
  professional: { name: "Rafa" },
  ...overrides,
});

describe("PortalAppointmentService", () => {
  const prismaMock = {
    appointment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  };
  const appointmentMock = { create: vi.fn(), update: vi.fn() };
  const availabilityMock = { findSlots: vi.fn() };
  const service = new PortalAppointmentService(
    prismaMock as unknown as PrismaService,
    appointmentMock as unknown as AppointmentService,
    availabilityMock as unknown as PortalAvailabilityService,
  );

  beforeEach(() => vi.clearAllMocks());

  describe("list", () => {
    it("separa próximos e passados, só do próprio cliente, e marca o que pode cancelar", async () => {
      prismaMock.appointment.findMany
        .mockResolvedValueOnce([
          item(),
          item({ id: "a-2", recurringAppointmentId: "r-1" }),
          item({
            id: "a-3",
            recurringAppointmentId: "r-2",
            recurringAppointment: { clientPlanId: "cp-1" },
          }),
          item({ id: "a-4", classSessionId: "cs-1" }),
          item({ id: "a-5", startAt: inHours(3) }),
        ])
        .mockResolvedValueOnce([
          item({ id: "a-9", startAt: inHours(-24), status: "COMPLETED" }),
        ]);

      const { upcoming, past } = await service.list(company, client);

      expect(upcoming.map((a) => [a.id, a.kind, a.canCancel])).toEqual([
        ["a-1", "SINGLE", true],
        ["a-2", "RECURRENCE", false],
        ["a-3", "PLAN", false],
        ["a-4", "CLASS", false],
        // Avulso, mas a menos de 24 h: fora do prazo.
        ["a-5", "SINGLE", false],
      ]);
      expect(past[0]).toMatchObject({ id: "a-9", canCancel: false });
      expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: "c-1",
            clientId: "cli-1",
          }) as object,
        }),
      );
    });
  });

  describe("book", () => {
    const dto = {
      serviceId: "s-1",
      professionalId: "p-1",
      startAt: new Date("2026-11-12T11:00:00.000Z"),
    };

    it("horário que está entre os livres: agenda pelo fluxo da clínica, com origem PORTAL", async () => {
      availabilityMock.findSlots.mockResolvedValue([
        { time: "08:00", startAt: "2026-11-12T11:00:00.000Z" },
      ]);
      appointmentMock.create.mockResolvedValue({ id: "a-1" });
      prismaMock.appointment.findUniqueOrThrow.mockResolvedValue(item());

      await service.book(company, client, dto);

      // O dia procurado é o do relógio da clínica (11:00Z = 08:00 em São Paulo, dia 12).
      expect(availabilityMock.findSlots).toHaveBeenCalledWith(
        company,
        "s-1",
        "p-1",
        "2026-11-12",
      );
      expect(appointmentMock.create).toHaveBeenCalledWith(
        {
          clientId: "cli-1",
          professionalId: "p-1",
          serviceId: "s-1",
          startAt: dto.startAt,
        },
        "c-1",
        "PORTAL",
      );
    });

    it("horário fora da lista de livres: 409, sem gravar", async () => {
      availabilityMock.findSlots.mockResolvedValue([
        { time: "13:00", startAt: "2026-11-12T16:00:00.000Z" },
      ]);
      await expect(service.book(company, client, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(appointmentMock.create).not.toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("avulso do próprio cliente, dentro do prazo: cancela pelo fluxo da clínica", async () => {
      prismaMock.appointment.findFirst.mockResolvedValue(item());
      await service.cancel(company, client, "a-1");
      expect(prismaMock.appointment.findFirst).toHaveBeenCalledWith({
        where: { id: "a-1", companyId: "c-1", clientId: "cli-1" },
      });
      expect(appointmentMock.update).toHaveBeenCalledWith(
        "a-1",
        { status: "CANCELLED" },
        "c-1",
      );
    });

    it("de outro cliente (ou inexistente): 404", async () => {
      prismaMock.appointment.findFirst.mockResolvedValue(null);
      await expect(
        service.cancel(company, client, "a-x"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      ["de recorrência", { recurringAppointmentId: "r-1" }],
      ["de turma", { classSessionId: "cs-1" }],
      ["fora do prazo (menos de 24 h)", { startAt: inHours(5) }],
    ])("%s: 400, sem cancelar", async (_, overrides) => {
      prismaMock.appointment.findFirst.mockResolvedValue(item(overrides));
      await expect(
        service.cancel(company, client, "a-1"),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(appointmentMock.update).not.toHaveBeenCalled();
    });
  });
});
