import { Prisma } from "../../../generated/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyAccessService } from "../company-access/company-access.service";
import type { ClientNotifierService } from "../portal/client-notifier.service";
import { defaultSettings } from "./auto-message.catalog";
import type { AutoMessageService } from "./auto-message.service";
import {
  AutoMessageSender,
  appointmentDedupKey,
} from "./auto-message-sender.service";

const COMPANY = {
  id: "company-1",
  name: "Studio Aurora",
  timezone: "America/Sao_Paulo",
};
const future = new Date(Date.now() + 2 * 86_400_000);
// 12/11/2026 09:00 em Brasília (o texto é conferido com uma data fixa).
const fixed = new Date("2099-11-12T12:00:00Z");

const appointment = (over: object = {}) => ({
  id: "appt-1",
  companyId: "company-1",
  status: "SCHEDULED",
  startAt: fixed,
  service: { name: "Pilates" },
  professional: { name: "Camila Rocha" },
  client: {
    id: "cli-1",
    name: "Ana Souza",
    clientAccountId: "acc-1",
    deletedAt: null,
  },
  ...over,
});

describe("AutoMessageSender", () => {
  const prismaMock = {
    company: { findUnique: vi.fn() },
    appointment: { findUnique: vi.fn() },
    autoMessageLog: { create: vi.fn() },
  };
  const settingsMock = { findOne: vi.fn() };
  const accessMock = { can: vi.fn() };
  const notifierMock = { notify: vi.fn() };
  const sender = new AutoMessageSender(
    prismaMock as unknown as PrismaService,
    settingsMock as unknown as AutoMessageService,
    accessMock as unknown as CompanyAccessService,
    notifierMock as unknown as ClientNotifierService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.company.findUnique.mockResolvedValue({
      id: "company-1",
      fantasyName: "Studio Aurora",
      corporateReason: "Aurora Ltda",
      timezone: "America/Sao_Paulo",
      isActive: true,
      portalSettings: { enabled: true },
    });
    accessMock.can.mockResolvedValue(true);
    settingsMock.findOne.mockImplementation((_c: string, kind: "REMINDER") =>
      Promise.resolve(defaultSettings(kind)),
    );
    prismaMock.appointment.findUnique.mockResolvedValue(appointment());
  });

  describe("sendingCompany", () => {
    it("ativa, portal ligado, portal e mensagens no plano", async () => {
      await expect(sender.sendingCompany("company-1")).resolves.toEqual(
        COMPANY,
      );
      expect(accessMock.can).toHaveBeenCalledWith(
        "company-1",
        "messages",
        "view",
      );
      expect(accessMock.can).toHaveBeenCalledWith(
        "company-1",
        "client-portal",
        "view",
      );
    });

    it.each([
      ["inativa", { isActive: false }],
      ["portal desligado", { portalSettings: { enabled: false } }],
      ["portal nunca configurado", { portalSettings: null }],
    ])("%s: não envia", async (_case, over) => {
      prismaMock.company.findUnique.mockResolvedValue({
        id: "company-1",
        fantasyName: null,
        corporateReason: "Aurora Ltda",
        timezone: "America/Sao_Paulo",
        isActive: true,
        portalSettings: { enabled: true },
        ...over,
      });
      await expect(sender.sendingCompany("company-1")).resolves.toBeNull();
    });

    it("sem Mensagens no plano: não envia", async () => {
      accessMock.can.mockImplementation((_c: string, feature: string) =>
        Promise.resolve(feature !== "messages"),
      );
      await expect(sender.sendingCompany("company-1")).resolves.toBeNull();
    });
  });

  describe("sendForAppointment", () => {
    it("monta o texto no relógio da clínica e entrega com o nome dela no título", async () => {
      await expect(
        sender.sendForAppointment("APPOINTMENT_CREATED", "appt-1"),
      ).resolves.toBe(true);
      expect(prismaMock.autoMessageLog.create).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          kind: "APPOINTMENT_CREATED",
          dedupKey: "created:appt-1",
          clientAccountId: "acc-1",
        },
      });
      expect(notifierMock.notify).toHaveBeenCalledWith({
        accountId: "acc-1",
        companyId: "company-1",
        kind: "APPOINTMENT",
        title: "Studio Aurora",
        body: "Olá, Ana! Seu horário foi marcado: Pilates com Camila Rocha em 12/11 às 09:00.",
        url: "/app/agendamentos",
      });
    });

    it("o lembrete leva o tempo na chave: o de 24h e o de 30 min são envios diferentes", async () => {
      await sender.sendForAppointment("REMINDER", "appt-1", {
        company: COMPANY,
        reminderOffset: 30,
      });
      expect(prismaMock.autoMessageLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          dedupKey: `reminder:appt-1:30:${fixed.toISOString()}`,
        }) as object,
      });
      expect(prismaMock.company.findUnique).not.toHaveBeenCalled();
    });

    it("já enviado (chave repetida): não entrega de novo", async () => {
      prismaMock.autoMessageLog.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("duplicado", {
          code: "P2002",
          clientVersion: "7",
        }),
      );
      await expect(
        sender.sendForAppointment("APPOINTMENT_CREATED", "appt-1"),
      ).resolves.toBe(false);
      expect(notifierMock.notify).not.toHaveBeenCalled();
    });

    it.each([
      [
        "horário que já passou",
        "APPOINTMENT_CREATED",
        { startAt: new Date(Date.now() - 60_000) },
      ],
      [
        "cliente sem conta no app",
        "APPOINTMENT_CREATED",
        {
          client: {
            id: "c",
            name: "Ana",
            clientAccountId: null,
            deletedAt: null,
          },
        },
      ],
      [
        "cliente inativo",
        "REMINDER",
        {
          client: {
            id: "c",
            name: "Ana",
            clientAccountId: "acc-1",
            deletedAt: new Date(),
          },
        },
      ],
      [
        "lembrete de agendamento cancelado",
        "REMINDER",
        { status: "CANCELLED" },
      ],
      [
        "cancelamento de agendamento que não foi cancelado",
        "APPOINTMENT_CANCELLED",
        { status: "SCHEDULED" },
      ],
    ] as const)("%s: não envia", async (_case, kind, over) => {
      prismaMock.appointment.findUnique.mockResolvedValue(
        appointment({ startAt: future, ...over }),
      );
      await expect(sender.sendForAppointment(kind, "appt-1")).resolves.toBe(
        false,
      );
      expect(notifierMock.notify).not.toHaveBeenCalled();
    });

    it("situação desligada pela clínica: não envia", async () => {
      settingsMock.findOne.mockResolvedValue({
        ...defaultSettings("APPOINTMENT_CANCELLED"),
        enabled: false,
      });
      prismaMock.appointment.findUnique.mockResolvedValue(
        appointment({ status: "CANCELLED" }),
      );
      await expect(
        sender.sendForAppointment("APPOINTMENT_CANCELLED", "appt-1"),
      ).resolves.toBe(false);
    });
  });

  it("sendToPerson troca o nome e o estabelecimento", async () => {
    await sender.sendToPerson(
      "BIRTHDAY",
      COMPANY,
      { name: "Ana Souza", clientAccountId: "acc-1" },
      "Feliz aniversário, {nome}! Beijos do {estabelecimento}.",
      "birthday:cli-1:2026",
    );
    expect(notifierMock.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "BIRTHDAY",
        body: "Feliz aniversário, Ana! Beijos do Studio Aurora.",
        url: undefined,
      }),
    );
  });
});

describe("appointmentDedupKey", () => {
  const appt = { id: "a", startAt: new Date("2026-11-12T12:00:00Z") };
  it("a mudança de horário entra na chave do lembrete e da alteração", () => {
    expect(appointmentDedupKey("APPOINTMENT_RESCHEDULED", appt)).toBe(
      "rescheduled:a:2026-11-12T12:00:00.000Z",
    );
    expect(appointmentDedupKey("REMINDER", appt, 1440)).toBe(
      "reminder:a:1440:2026-11-12T12:00:00.000Z",
    );
    expect(appointmentDedupKey("APPOINTMENT_CANCELLED", appt)).toBe(
      "cancelled:a",
    );
  });
});
