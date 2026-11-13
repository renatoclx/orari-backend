import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyService } from "../company/company.service";
import {
  AppointmentNotifierListener,
  dayOf,
  whenOf,
} from "./appointment-notifier.listener";
import type { NotificationDispatcher } from "./notification-dispatcher.service";

const TZ = "America/Sao_Paulo";
// 14/11/2026 às 09:00 em São Paulo (UTC-3).
const STARTS = new Date("2026-11-14T12:00:00.000Z");
const event = { appointmentId: "a1", companyId: "company-1" };

describe("whenOf e dayOf", () => {
  it("usam o relógio da clínica", () => {
    expect(whenOf(STARTS, TZ)).toBe("14/11 às 09:00");
    // 01:00 UTC de 15/11 ainda é 14/11 (22:00) em São Paulo.
    const late = new Date("2026-11-15T01:00:00.000Z");
    expect(whenOf(late, TZ)).toBe("14/11 às 22:00");
    expect(dayOf(late, TZ)).toBe("2026-11-14");
  });
});

describe("AppointmentNotifierListener", () => {
  const prismaMock = {
    appointment: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  };
  const companyMock = { getTimeZone: vi.fn() };
  const dispatcherMock = { notify: vi.fn() };
  const listener = new AppointmentNotifierListener(
    prismaMock as unknown as PrismaService,
    companyMock as unknown as CompanyService,
    dispatcherMock as unknown as NotificationDispatcher,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    companyMock.getTimeZone.mockResolvedValue(TZ);
    prismaMock.appointment.findUnique.mockResolvedValue({
      companyId: "company-1",
      professionalId: "pro-1",
      startAt: STARTS,
      client: { name: "Ana Souza" },
      professional: { name: "Camila Rocha" },
      service: { name: "Corte" },
    });
    prismaMock.user.findMany.mockResolvedValue([
      { id: "admin-1", type: "ADMIN" },
      { id: "admin-2", type: "ADMIN" },
      { id: "pro-user", type: "PROFESSIONAL" },
    ]);
    dispatcherMock.notify.mockResolvedValue(1);
  });

  it("agendamento marcado pelo cliente: avisa os administradores (painel) e o profissional (app, na agenda do dia)", async () => {
    await listener.onCreated(event);

    expect(dispatcherMock.notify).toHaveBeenCalledTimes(2);
    const [admins, professional] = dispatcherMock.notify.mock.calls as [
      Record<string, unknown>,
    ][];
    expect(admins[0]).toMatchObject({
      companyId: "company-1",
      userIds: ["admin-1", "admin-2"],
      category: "APPOINTMENT",
      title: "Novo agendamento pelo app",
      body: "Ana Souza marcou Corte com Camila Rocha em 14/11 às 09:00.",
      url: "/",
      dedupeKey: "appointment:a1:created-by-client",
    });
    expect(professional[0]).toMatchObject({
      userIds: ["pro-user"],
      url: "/app/agenda?dia=2026-11-14",
      dedupeKey: "appointment:a1:created-by-client",
    });
  });

  it("o push não leva o nome do cliente", async () => {
    await listener.onCreated(event);
    const [[first]] = dispatcherMock.notify.mock.calls as [
      { push: { title: string; body: string } },
    ][];
    expect(first.push.body).toBe("Horário marcado para 14/11 às 09:00.");
    expect(JSON.stringify(first.push)).not.toContain("Ana");
  });

  it("cancelamento pelo cliente: texto e chave próprios", async () => {
    await listener.onCancelled(event);
    const [[first]] = dispatcherMock.notify.mock.calls as [
      Record<string, unknown>,
    ][];
    expect(first).toMatchObject({
      title: "Agendamento cancelado pelo cliente",
      body: "Ana Souza cancelou Corte com Camila Rocha (14/11 às 09:00).",
      dedupeKey: "appointment:a1:cancelled-by-client",
    });
  });

  it("busca só os administradores e o usuário ligado ao profissional da empresa", async () => {
    await listener.onCreated(event);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: {
        companyId: "company-1",
        deletedAt: null,
        OR: [{ type: "ADMIN" }, { peopleId: "pro-1" }],
      },
      select: { id: true, type: true },
    });
  });

  it("agendamento que não existe mais: não faz nada", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(null);
    await listener.onCreated(event);
    expect(dispatcherMock.notify).not.toHaveBeenCalled();
  });

  it("falha ao avisar não vaza (quem marcou não espera nem vê)", async () => {
    dispatcherMock.notify.mockRejectedValue(new Error("banco"));
    await expect(listener.onCreated(event)).resolves.toBeUndefined();
  });
});
