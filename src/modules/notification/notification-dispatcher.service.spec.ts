import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";
import type { PushSenderService } from "../portal/push-sender.service";
import {
  NotificationDispatcher,
  type NotifyInput,
} from "./notification-dispatcher.service";

const input: NotifyInput = {
  companyId: "company-1",
  userIds: ["u1", "u2"],
  category: "APPOINTMENT",
  title: "Novo agendamento",
  body: "Ana marcou Corte em 14/11 às 09:00.",
  url: "/",
  dedupeKey: "appointment:a1:created-by-client",
  push: {
    title: "Novo agendamento",
    body: "Horário marcado para 14/11 às 09:00.",
  },
};

// Violação de chave única, como o Prisma a reporta.
const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });

describe("NotificationDispatcher", () => {
  const prismaMock = {
    user: { findMany: vi.fn() },
    userNotification: { create: vi.fn() },
    userNotificationPreference: { findUnique: vi.fn() },
    userPushSubscription: { findMany: vi.fn(), deleteMany: vi.fn() },
  };
  const pushMock = { enabled: true, send: vi.fn() };
  const dispatcher = new NotificationDispatcher(
    prismaMock as unknown as PrismaService,
    pushMock as unknown as PushSenderService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    pushMock.enabled = true;
    prismaMock.user.findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    prismaMock.userNotification.create.mockResolvedValue({});
    prismaMock.userNotificationPreference.findUnique.mockResolvedValue(null);
    prismaMock.userPushSubscription.findMany.mockResolvedValue([
      {
        id: "d1",
        endpoint: "https://fcm.googleapis.com/x",
        p256dh: "p",
        auth: "a",
      },
    ]);
    pushMock.send.mockResolvedValue("sent");
  });

  it("grava uma notificação por usuário e manda o push com o texto genérico", async () => {
    const created = await dispatcher.notify(input);

    expect(created).toBe(2);
    expect(prismaMock.userNotification.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.userNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        title: "Novo agendamento",
        body: "Ana marcou Corte em 14/11 às 09:00.",
        dedupeKey: "appointment:a1:created-by-client",
      }) as object,
    });
    // O push não leva o nome do cliente: a tela bloqueada é pública.
    expect(pushMock.send).toHaveBeenCalledWith(expect.anything(), {
      title: "Novo agendamento",
      body: "Horário marcado para 14/11 às 09:00.",
      url: "/",
    });
  });

  it("só entram usuários ativos da empresa", async () => {
    await dispatcher.notify(input);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["u1", "u2"] },
        companyId: "company-1",
        deletedAt: null,
      },
      select: { id: true },
    });
  });

  it("o mesmo evento repetido não duplica a notificação nem o push", async () => {
    prismaMock.userNotification.create.mockRejectedValue(uniqueViolation());
    const created = await dispatcher.notify(input);
    expect(created).toBe(0);
    expect(pushMock.send).not.toHaveBeenCalled();
  });

  it("usuários repetidos na lista recebem uma vez só", async () => {
    await dispatcher.notify({ ...input, userIds: ["u1", "u1"] });
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["u1"] } }) as object,
      }),
    );
  });

  it("sem destinatários, nada acontece", async () => {
    expect(await dispatcher.notify({ ...input, userIds: [] })).toBe(0);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it("push desligado pelo usuário: fica só na caixa", async () => {
    prismaMock.userNotificationPreference.findUnique.mockResolvedValue({
      push: false,
    });
    const created = await dispatcher.notify(input);
    expect(created).toBe(2);
    expect(pushMock.send).not.toHaveBeenCalled();
  });

  it("push desligado no servidor: fica só na caixa", async () => {
    pushMock.enabled = false;
    await dispatcher.notify(input);
    expect(prismaMock.userNotification.create).toHaveBeenCalled();
    expect(pushMock.send).not.toHaveBeenCalled();
  });

  it("sem push no texto, usa o da caixa", async () => {
    await dispatcher.notify({ ...input, push: undefined, userIds: ["u1"] });
    expect(pushMock.send).toHaveBeenCalledWith(expect.anything(), {
      title: "Novo agendamento",
      body: "Ana marcou Corte em 14/11 às 09:00.",
      url: "/",
    });
  });

  it("aparelho que deixou de existir tem a inscrição apagada", async () => {
    pushMock.send.mockResolvedValue("gone");
    await dispatcher.notify({ ...input, userIds: ["u1"] });
    expect(prismaMock.userPushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: "d1" },
    });
  });

  it("falha no push não derruba a notificação (já está na caixa)", async () => {
    pushMock.send.mockRejectedValue(new Error("rede"));
    prismaMock.user.findMany.mockResolvedValue([{ id: "u1" }]);
    const created = await dispatcher.notify({ ...input, userIds: ["u1"] });
    expect(created).toBe(1);
  });

  it("erro inesperado ao gravar (que não é duplicidade) sobe", async () => {
    prismaMock.userNotification.create.mockRejectedValue(new Error("banco"));
    await expect(dispatcher.notify(input)).rejects.toThrow("banco");
  });
});
