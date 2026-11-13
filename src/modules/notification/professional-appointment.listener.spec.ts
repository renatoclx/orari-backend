import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyService } from "../company/company.service";
import type { NotificationDispatcher } from "./notification-dispatcher.service";
import { ProfessionalAppointmentListener } from "./professional-appointment.listener";

const TZ = "America/Sao_Paulo";
// 16/11 às 08:00 em São Paulo (UTC-3).
const STARTS = new Date("2026-11-16T11:00:00.000Z");
const event = { appointmentId: "a1", companyId: "company-1" };

describe("ProfessionalAppointmentListener", () => {
  const prismaMock = {
    appointment: { findUnique: vi.fn() },
    classSession: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
  };
  const companyMock = { getTimeZone: vi.fn() };
  const dispatcherMock = { notify: vi.fn() };
  const listener = new ProfessionalAppointmentListener(
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
      service: { name: "Corte" },
    });
    prismaMock.user.findMany.mockResolvedValue([{ id: "pro-user" }]);
    dispatcherMock.notify.mockResolvedValue(1);
  });

  it("a clínica marca: avisa só o usuário PROFESSIONAL ligado ao profissional", async () => {
    await listener.onCreated(event);

    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: {
        companyId: "company-1",
        deletedAt: null,
        type: "PROFESSIONAL",
        peopleId: "pro-1",
      },
      select: { id: true },
    });
    expect(dispatcherMock.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ["pro-user"],
        category: "APPOINTMENT",
        title: "Novo agendamento",
        body: "Ana Souza (Corte): 16/11 às 08:00.",
        url: "/app/agenda?dia=2026-11-16",
        dedupeKey: "appointment:a1:created",
      }),
    );
  });

  it("o push não leva o nome do cliente", async () => {
    await listener.onCreated(event);
    const [[call]] = dispatcherMock.notify.mock.calls as [
      { push: { title: string; body: string } },
    ][];
    expect(call.push.body).toBe("Novo horário em 16/11 às 08:00.");
    expect(JSON.stringify(call.push)).not.toContain("Ana");
  });

  it("remarcado: cada remarcação tem a sua chave (leva o novo horário)", async () => {
    await listener.onRescheduled(event);
    const [[call]] = dispatcherMock.notify.mock.calls as [
      { title: string; dedupeKey: string },
    ][];
    expect(call.title).toBe("Agendamento remarcado");
    expect(call.dedupeKey).toBe(
      `appointment:a1:rescheduled:${STARTS.getTime()}`,
    );
  });

  it("cancelado pela clínica: texto e chave próprios", async () => {
    await listener.onCancelled(event);
    expect(dispatcherMock.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Agendamento cancelado",
        body: "A clínica cancelou Ana Souza (Corte) de 16/11 às 08:00.",
        dedupeKey: "appointment:a1:cancelled",
      }),
    );
  });

  it("turma cancelada: um aviso só para o profissional, não um por aluno", async () => {
    prismaMock.classSession.findFirst.mockResolvedValue({
      professionalId: "pro-1",
      startAt: STARTS,
      service: { name: "Pilates" },
    });
    await listener.onClassSessionCancelled({
      classSessionId: "s1",
      companyId: "company-1",
    });
    expect(dispatcherMock.notify).toHaveBeenCalledTimes(1);
    expect(dispatcherMock.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Turma cancelada",
        body: "A turma de Pilates de 16/11 às 08:00 foi cancelada.",
        dedupeKey: "class-session:s1:cancelled",
      }),
    );
  });

  it("agendamento ou sessão que não existe mais: não faz nada", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(null);
    prismaMock.classSession.findFirst.mockResolvedValue(null);
    await listener.onCreated(event);
    await listener.onClassSessionCancelled({
      classSessionId: "s9",
      companyId: "company-1",
    });
    expect(dispatcherMock.notify).not.toHaveBeenCalled();
  });

  it("falha ao avisar não vaza (quem fez a ação não espera nem vê)", async () => {
    dispatcherMock.notify.mockRejectedValue(new Error("banco"));
    await expect(listener.onCreated(event)).resolves.toBeUndefined();
  });
});
