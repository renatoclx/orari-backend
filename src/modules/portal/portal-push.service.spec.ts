import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { ClientNotifierService } from "./client-notifier.service";
import { PortalPushService } from "./portal-push.service";
import type { PushSenderService } from "./push-sender.service";

const ACCOUNT = { sessionId: "s-1", accountId: "acc-1" };
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  expirationTime: null,
  keys: { p256dh: "p", auth: "a" },
};

describe("PortalPushService", () => {
  const prismaMock = {
    clientAccount: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    pushSubscription: { upsert: vi.fn(), deleteMany: vi.fn() },
    clientMessage: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
  };
  const senderMock = {
    enabled: true,
    publicKey: "chave-publica" as string | null,
  };
  const notifierMock = { notify: vi.fn() };
  const service = new PortalPushService(
    prismaMock as unknown as PrismaService,
    senderMock as unknown as PushSenderService,
    notifierMock as unknown as ClientNotifierService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    senderMock.enabled = true;
    senderMock.publicKey = "chave-publica";
  });

  it("info: a chave pública e os interruptores", async () => {
    prismaMock.clientAccount.findUniqueOrThrow.mockResolvedValue({
      notifyAppointments: true,
      notifyPromotions: false,
    });
    await expect(service.info(ACCOUNT)).resolves.toEqual({
      publicKey: "chave-publica",
      notifyAppointments: true,
      notifyPromotions: false,
    });
  });

  describe("subscribe", () => {
    it("liga o aparelho a esta conta e sessão (mesmo se outra conta usou antes)", async () => {
      await service.subscribe(ACCOUNT, subscription, "iPhone");
      const data = {
        clientAccountId: "acc-1",
        portalSessionId: "s-1",
        p256dh: "p",
        auth: "a",
        userAgent: "iPhone",
      };
      expect(prismaMock.pushSubscription.upsert).toHaveBeenCalledWith({
        where: { endpoint: subscription.endpoint },
        create: { endpoint: subscription.endpoint, ...data },
        update: data,
      });
    });

    it("recusa endereço que não é de um serviço de push (400)", async () => {
      await expect(
        service.subscribe(ACCOUNT, {
          ...subscription,
          endpoint: "https://exemplo.com/coleta",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.pushSubscription.upsert).not.toHaveBeenCalled();
    });

    it("push desligado no servidor: 503", async () => {
      senderMock.enabled = false;
      await expect(
        service.subscribe(ACCOUNT, subscription),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  it("unsubscribe apaga só a inscrição da própria conta", async () => {
    await service.unsubscribe(ACCOUNT, subscription.endpoint);
    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: subscription.endpoint, clientAccountId: "acc-1" },
    });
  });

  it("sendTest avisa os aparelhos da conta, sem clínica", async () => {
    notifierMock.notify.mockResolvedValue({ saved: true, devices: 2 });
    await expect(service.sendTest(ACCOUNT)).resolves.toEqual({ devices: 2 });
    expect(notifierMock.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acc-1",
        companyId: null,
        kind: "TEST",
      }),
    );
  });

  it("sendTest com o push desligado: 503", async () => {
    senderMock.enabled = false;
    await expect(service.sendTest(ACCOUNT)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("messages: só da conta, paginada, com o nome exibido da clínica", async () => {
    const createdAt = new Date("2026-11-05T12:00:00Z");
    prismaMock.clientMessage.findMany.mockResolvedValue([
      {
        id: "m-1",
        kind: "REMINDER",
        title: "Studio Aurora",
        body: "Pilates amanhã",
        url: "/app/agendamentos",
        readAt: null,
        createdAt,
        company: {
          fantasyName: null,
          corporateReason: "Aurora Ltda",
          logoUrl: null,
        },
      },
      {
        id: "m-2",
        kind: "TEST",
        title: "Orari",
        body: "Teste",
        url: "/app/avisos",
        readAt: createdAt,
        createdAt,
        company: null,
      },
    ]);
    prismaMock.clientMessage.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(1);

    const result = await service.messages(ACCOUNT, 2, 10);
    expect(prismaMock.clientMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientAccountId: "acc-1" },
        orderBy: { createdAt: "desc" },
        skip: 10,
        take: 10,
      }),
    );
    expect(result).toMatchObject({ total: 12, unread: 1, page: 2, limit: 10 });
    expect(result.items[0].place).toEqual({
      name: "Aurora Ltda",
      logoUrl: null,
    });
    expect(result.items[1].place).toBeNull();
  });

  it("markAllRead marca só os não lidos da conta", async () => {
    await service.markAllRead(ACCOUNT);
    expect(prismaMock.clientMessage.updateMany).toHaveBeenCalledWith({
      where: { clientAccountId: "acc-1", readAt: null },
      data: { readAt: expect.any(Date) as Date },
    });
  });
});
