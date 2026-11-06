import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { AutoMessageSender } from "./auto-message-sender.service";
import { AutoMessageListener } from "./auto-message.listener";

describe("AutoMessageListener", () => {
  const prismaMock = { appointment: { findMany: vi.fn() } };
  const senderMock = { sendingCompany: vi.fn(), sendForAppointment: vi.fn() };
  const listener = new AutoMessageListener(
    prismaMock as unknown as PrismaService,
    senderMock as unknown as AutoMessageSender,
  );
  const event = { appointmentId: "a-1", companyId: "c-1" };

  beforeEach(() => vi.clearAllMocks());

  it("cada anúncio vira a situação certa", async () => {
    await listener.onCreated(event);
    await listener.onRescheduled(event);
    await listener.onCancelled(event);
    expect(senderMock.sendForAppointment.mock.calls).toEqual([
      ["APPOINTMENT_CREATED", "a-1"],
      ["APPOINTMENT_RESCHEDULED", "a-1"],
      ["APPOINTMENT_CANCELLED", "a-1"],
    ]);
  });

  it("sessão de turma cancelada: um aviso para cada aluno cancelado por ela", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([
      { id: "a-1" },
      { id: "a-2" },
    ]);
    senderMock.sendingCompany.mockResolvedValue({ id: "c-1" });
    await listener.onClassSessionCancelled({
      classSessionId: "s-1",
      companyId: "c-1",
    });
    expect(prismaMock.appointment.findMany).toHaveBeenCalledWith({
      where: {
        classSessionId: "s-1",
        companyId: "c-1",
        status: "CANCELLED",
        cancelReason: "CLASS_SESSION_CANCELLED",
      },
      select: { id: true },
    });
    expect(senderMock.sendForAppointment).toHaveBeenCalledTimes(2);
  });

  it("uma falha no envio não escapa (só vai para o log)", async () => {
    senderMock.sendForAppointment.mockRejectedValue(new Error("banco fora"));
    await expect(listener.onCreated(event)).resolves.toBeUndefined();
  });
});
