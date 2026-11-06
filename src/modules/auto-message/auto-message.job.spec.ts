import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import { defaultSettings } from "./auto-message.catalog";
import type { AutoMessageService } from "./auto-message.service";
import type { AutoMessageSender } from "./auto-message-sender.service";
import { AutoMessageJob } from "./auto-message.job";

const TZ = "America/Sao_Paulo";
const COMPANY = { id: "company-1", name: "Studio Aurora", timezone: TZ };
// 05/11/2026 às 09:00 em Brasília.
const AT_9 = new Date("2026-11-05T12:00:00Z");
const AT_10 = new Date("2026-11-05T13:00:00Z");

describe("AutoMessageJob", () => {
  const prismaMock = {
    companyFeatureAccess: { findMany: vi.fn() },
    appointment: { findMany: vi.fn(), count: vi.fn() },
    people: { findMany: vi.fn() },
  };
  const settingsMock = { findOne: vi.fn() };
  const senderMock = {
    sendingCompany: vi.fn(),
    sendForAppointment: vi.fn(),
    sendToPerson: vi.fn(),
  };
  const job = new AutoMessageJob(
    prismaMock as unknown as PrismaService,
    settingsMock as unknown as AutoMessageService,
    senderMock as unknown as AutoMessageSender,
  );
  const enable = (kind: "BIRTHDAY" | "MISS_YOU") =>
    settingsMock.findOne.mockImplementation((_c: string, k: typeof kind) =>
      Promise.resolve({
        ...defaultSettings(k),
        enabled: k === kind || defaultSettings(k).enabled,
      }),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.companyFeatureAccess.findMany.mockResolvedValue([
      { companyId: "company-1" },
    ]);
    senderMock.sendingCompany.mockResolvedValue(COMPANY);
    settingsMock.findOne.mockImplementation((_c: string, kind: "REMINDER") =>
      Promise.resolve(defaultSettings(kind)),
    );
    prismaMock.appointment.findMany.mockResolvedValue([]);
    senderMock.sendForAppointment.mockResolvedValue(true);
    senderMock.sendToPerson.mockResolvedValue(true);
  });

  describe("reminders", () => {
    it("procura, para cada tempo, os horários cujo lembrete chegou há até 15 min", async () => {
      prismaMock.appointment.findMany
        .mockResolvedValueOnce([{ id: "a-24h" }])
        .mockResolvedValueOnce([{ id: "a-30" }]);

      await expect(job.reminders(AT_9)).resolves.toBe(2);

      expect(prismaMock.appointment.findMany).toHaveBeenNthCalledWith(1, {
        where: {
          companyId: "company-1",
          status: { in: ["SCHEDULED", "CONFIRMED"] },
          startAt: {
            gt: new Date("2026-11-06T11:45:00Z"),
            lte: new Date("2026-11-06T12:00:00Z"),
          },
          client: {
            type: "CLIENT",
            deletedAt: null,
            clientAccountId: { not: null },
          },
        },
        select: { id: true },
      });
      expect(senderMock.sendForAppointment).toHaveBeenCalledWith(
        "REMINDER",
        "a-24h",
        {
          company: COMPANY,
          reminderOffset: 1440,
        },
      );
      expect(senderMock.sendForAppointment).toHaveBeenCalledWith(
        "REMINDER",
        "a-30",
        {
          company: COMPANY,
          reminderOffset: 30,
        },
      );
    });

    it("clínica que não pode enviar (ex.: portal desligado): nada", async () => {
      senderMock.sendingCompany.mockResolvedValue(null);
      await expect(job.reminders(AT_9)).resolves.toBe(0);
      expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
    });

    it("lembrete desligado pela clínica: nada", async () => {
      settingsMock.findOne.mockResolvedValue({
        ...defaultSettings("REMINDER"),
        enabled: false,
      });
      await expect(job.reminders(AT_9)).resolves.toBe(0);
      expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
    });
  });

  describe("daily", () => {
    it("aniversário só às 9h da clínica, para quem faz aniversário hoje", async () => {
      enable("BIRTHDAY");
      prismaMock.people.findMany.mockResolvedValue([
        {
          id: "p-1",
          name: "Ana Souza",
          birthDate: new Date("1990-11-05T00:00:00Z"),
          clientAccountId: "acc-1",
        },
        {
          id: "p-2",
          name: "Bia Lima",
          birthDate: new Date("1990-11-06T00:00:00Z"),
          clientAccountId: "acc-2",
        },
      ]);

      await expect(job.daily(AT_9)).resolves.toBe(1);
      expect(senderMock.sendToPerson).toHaveBeenCalledWith(
        "BIRTHDAY",
        COMPANY,
        { name: "Ana Souza", clientAccountId: "acc-1" },
        defaultSettings("BIRTHDAY").body,
        "birthday:p-1:2026",
      );
    });

    it("fora das 9h e das 10h, nada", async () => {
      enable("BIRTHDAY");
      await expect(job.daily(new Date("2026-11-05T15:00:00Z"))).resolves.toBe(
        0,
      );
      expect(prismaMock.people.findMany).not.toHaveBeenCalled();
    });

    it("aniversário desligado (padrão): não procura ninguém", async () => {
      await job.daily(AT_9);
      expect(prismaMock.people.findMany).not.toHaveBeenCalled();
    });

    describe("sentimos sua falta (às 10h, 30 dias)", () => {
      beforeEach(() => {
        enable("MISS_YOU");
        prismaMock.appointment.findMany.mockResolvedValue([
          {
            client: {
              id: "cli-1",
              name: "Ana Souza",
              clientAccountId: "acc-1",
            },
          },
        ]);
      });

      it("último atendimento exatamente 30 dias atrás, no dia da clínica", async () => {
        prismaMock.appointment.count.mockResolvedValue(0);
        await expect(job.daily(AT_10)).resolves.toBe(1);
        // 06/10/2026 inteiro em Brasília (UTC−3).
        expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status: "COMPLETED",
              endAt: {
                gte: new Date("2026-10-06T03:00:00Z"),
                lt: new Date("2026-10-07T03:00:00Z"),
              },
            }) as object,
          }),
        );
        expect(senderMock.sendToPerson).toHaveBeenCalledWith(
          "MISS_YOU",
          COMPANY,
          { name: "Ana Souza", clientAccountId: "acc-1" },
          defaultSettings("MISS_YOU").body,
          "miss-you:cli-1:2026-10-06",
        );
      });

      it("voltou depois ou tem horário marcado: não envia", async () => {
        prismaMock.appointment.count.mockResolvedValue(1);
        await expect(job.daily(AT_10)).resolves.toBe(0);
        expect(senderMock.sendToPerson).not.toHaveBeenCalled();
      });
    });
  });
});
