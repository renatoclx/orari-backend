import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import {
  ClientNotifierService,
  MESSAGES_PATH,
} from "./client-notifier.service";
import type { PushSenderService } from "./push-sender.service";

const notice = {
  accountId: "acc-1",
  companyId: "company-1",
  kind: "REMINDER" as const,
  title: "Studio Aurora",
  body: "Pilates amanhã às 09:00",
};
const both = { notifyAppointments: true, notifyPromotions: true };

describe("ClientNotifierService", () => {
  const prismaMock = {
    clientAccount: { findUnique: vi.fn() },
    clientMessage: { create: vi.fn() },
    pushSubscription: { findMany: vi.fn(), deleteMany: vi.fn() },
  };
  const senderMock = { enabled: true, send: vi.fn() };
  const service = new ClientNotifierService(
    prismaMock as unknown as PrismaService,
    senderMock as unknown as PushSenderService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    senderMock.enabled = true;
    prismaMock.clientAccount.findUnique.mockResolvedValue(both);
    prismaMock.pushSubscription.findMany.mockResolvedValue([]);
  });

  it("grava na caixa de Avisos e envia aos aparelhos com sessão em vigor", async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([
      { id: "sub-1", endpoint: "e1", p256dh: "p", auth: "a" },
      { id: "sub-2", endpoint: "e2", p256dh: "p", auth: "a" },
    ]);
    senderMock.send.mockResolvedValue("sent");

    await expect(service.notify(notice)).resolves.toEqual({
      saved: true,
      devices: 2,
    });
    expect(prismaMock.clientMessage.create).toHaveBeenCalledWith({
      data: {
        clientAccountId: "acc-1",
        companyId: "company-1",
        kind: "REMINDER",
        title: notice.title,
        body: notice.body,
        url: MESSAGES_PATH,
      },
    });
    expect(prismaMock.pushSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clientAccountId: "acc-1",
          portalSession: {
            revokedAt: null,
            expiresAt: { gt: expect.any(Date) as Date },
          },
        },
      }),
    );
    expect(senderMock.send).toHaveBeenCalledWith(
      { id: "sub-1", endpoint: "e1", p256dh: "p", auth: "a" },
      { title: notice.title, body: notice.body, url: MESSAGES_PATH },
    );
  });

  it("apaga só os aparelhos que deixaram de existir", async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([
      { id: "sub-1", endpoint: "e1", p256dh: "p", auth: "a" },
      { id: "sub-2", endpoint: "e2", p256dh: "p", auth: "a" },
      { id: "sub-3", endpoint: "e3", p256dh: "p", auth: "a" },
    ]);
    senderMock.send
      .mockResolvedValueOnce("gone")
      .mockResolvedValueOnce("sent")
      .mockResolvedValueOnce("failed");

    await expect(service.notify(notice)).resolves.toEqual({
      saved: true,
      devices: 1,
    });
    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["sub-1"] } },
    });
  });

  it.each([
    ["REMINDER", { ...both, notifyAppointments: false }],
    ["APPOINTMENT", { ...both, notifyAppointments: false }],
    ["BIRTHDAY", { ...both, notifyPromotions: false }],
    ["MISS_YOU", { ...both, notifyPromotions: false }],
    ["CAMPAIGN", { ...both, notifyPromotions: false }],
  ] as const)(
    "%s com o interruptor desligado: nem grava nem envia",
    async (kind, prefs) => {
      prismaMock.clientAccount.findUnique.mockResolvedValue(prefs);
      await expect(service.notify({ ...notice, kind })).resolves.toEqual({
        saved: false,
        devices: 0,
      });
      expect(prismaMock.clientMessage.create).not.toHaveBeenCalled();
      expect(senderMock.send).not.toHaveBeenCalled();
    },
  );

  it("o teste vale mesmo com os dois interruptores desligados", async () => {
    prismaMock.clientAccount.findUnique.mockResolvedValue({
      notifyAppointments: false,
      notifyPromotions: false,
    });
    const result = await service.notify({
      ...notice,
      kind: "TEST",
      companyId: null,
    });
    expect(result.saved).toBe(true);
  });

  it("push desligado no servidor: grava na caixa, sem enviar", async () => {
    senderMock.enabled = false;
    await expect(service.notify(notice)).resolves.toEqual({
      saved: true,
      devices: 0,
    });
    expect(prismaMock.clientMessage.create).toHaveBeenCalled();
    expect(prismaMock.pushSubscription.findMany).not.toHaveBeenCalled();
  });

  it("nunca lança: uma falha vira { saved: false } e vai para o log", async () => {
    prismaMock.clientMessage.create.mockRejectedValue(new Error("banco fora"));
    await expect(service.notify(notice)).resolves.toEqual({
      saved: false,
      devices: 0,
    });
  });
});
