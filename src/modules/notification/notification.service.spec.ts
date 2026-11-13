import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import type { PrismaService } from "../../prisma/prisma.service";
import type { PushSenderService } from "../portal/push-sender.service";
import { FindNotificationsQueryDto } from "./dto/find-notifications-query.dto";
import { NotificationService } from "./notification.service";

const user = { id: "user-1", companyId: "company-1" } as AuthenticatedUser;
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const subscription = {
  endpoint: ENDPOINT,
  keys: { p256dh: "p", auth: "a" },
};

const query = (extra: Partial<FindNotificationsQueryDto> = {}) =>
  Object.assign(new FindNotificationsQueryDto(), extra);

describe("NotificationService", () => {
  const prismaMock = {
    $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    userNotification: {
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    userNotificationPreference: { findMany: vi.fn(), upsert: vi.fn() },
    userPushSubscription: { upsert: vi.fn(), deleteMany: vi.fn() },
  };
  const pushMock = { enabled: true, publicKey: "chave-publica" };
  const service = new NotificationService(
    prismaMock as unknown as PrismaService,
    pushMock as unknown as PushSenderService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    pushMock.enabled = true;
    prismaMock.userNotification.findMany.mockResolvedValue([]);
    prismaMock.userNotification.count.mockResolvedValue(0);
    prismaMock.userNotificationPreference.findMany.mockResolvedValue([]);
  });

  describe("findAll", () => {
    it("lista só as do usuário, das mais novas às mais antigas, com o total de não lidas", async () => {
      prismaMock.userNotification.count
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(5);

      const result = await service.findAll(user, query({ page: 2 }));

      const args = prismaMock.userNotification.findMany.mock
        .calls[0][0] as Record<string, unknown>;
      expect(args.where).toEqual({ userId: "user-1" });
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
      expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
      expect(result).toMatchObject({
        total: 12,
        unread: 5,
        page: 2,
        limit: 10,
      });
    });

    it("com onlyUnread, filtra as não lidas, mas o contador segue sendo o total de não lidas", async () => {
      await service.findAll(user, query({ onlyUnread: true }));
      const args = prismaMock.userNotification.findMany.mock
        .calls[0][0] as Record<string, unknown>;
      expect(args.where).toEqual({ userId: "user-1", readAt: null });
      expect(prismaMock.userNotification.count).toHaveBeenLastCalledWith({
        where: { userId: "user-1", readAt: null },
      });
    });
  });

  it("unreadCount conta só as não lidas dele", async () => {
    prismaMock.userNotification.count.mockResolvedValue(3);
    expect(await service.unreadCount(user)).toEqual({ unread: 3 });
    expect(prismaMock.userNotification.count).toHaveBeenCalledWith({
      where: { userId: "user-1", readAt: null },
    });
  });

  describe("marcar como lida", () => {
    it("marca só se for dele", async () => {
      prismaMock.userNotification.updateMany.mockResolvedValue({ count: 1 });
      await service.markAsRead(user, "n1");
      expect(prismaMock.userNotification.updateMany).toHaveBeenCalledWith({
        where: { id: "n1", userId: "user-1" },
        data: { readAt: expect.any(Date) as Date },
      });
    });

    it("a de outro usuário (ou inexistente) responde 404", async () => {
      prismaMock.userNotification.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.markAsRead(user, "n9")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("marcar todas mexe só nas não lidas dele", async () => {
      await service.markAllAsRead(user);
      expect(prismaMock.userNotification.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1", readAt: null },
        data: { readAt: expect.any(Date) as Date },
      });
    });
  });

  describe("preferências", () => {
    it("sem linha, o push vale o padrão (ligado) e a chave pública vem junto", async () => {
      const result = await service.preferences(user);
      expect(result).toEqual({
        publicKey: "chave-publica",
        preferences: [{ category: "APPOINTMENT", push: true }],
      });
    });

    it("mostra o que o usuário gravou", async () => {
      prismaMock.userNotificationPreference.findMany.mockResolvedValue([
        { category: "APPOINTMENT", push: false },
      ]);
      const result = await service.preferences(user);
      expect(result.preferences).toEqual([
        { category: "APPOINTMENT", push: false },
      ]);
    });

    it("grava cada categoria enviada", async () => {
      await service.updatePreferences(user, {
        preferences: [{ category: "APPOINTMENT", push: false }],
      });
      expect(prismaMock.userNotificationPreference.upsert).toHaveBeenCalledWith(
        {
          where: {
            userId_category: { userId: "user-1", category: "APPOINTMENT" },
          },
          create: { userId: "user-1", category: "APPOINTMENT", push: false },
          update: { push: false },
        },
      );
    });

    it("categoria repetida responde 400, sem gravar", async () => {
      await expect(
        service.updatePreferences(user, {
          preferences: [
            { category: "APPOINTMENT", push: false },
            { category: "APPOINTMENT", push: true },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(
        prismaMock.userNotificationPreference.upsert,
      ).not.toHaveBeenCalled();
    });
  });

  describe("push do aparelho", () => {
    it("ativa neste aparelho e passa o endereço para quem ativar por último", async () => {
      await service.subscribe(user, subscription, "Mozilla/5.0");
      expect(prismaMock.userPushSubscription.upsert).toHaveBeenCalledWith({
        where: { endpoint: ENDPOINT },
        create: {
          endpoint: ENDPOINT,
          userId: "user-1",
          p256dh: "p",
          auth: "a",
          userAgent: "Mozilla/5.0",
        },
        update: {
          userId: "user-1",
          p256dh: "p",
          auth: "a",
          userAgent: "Mozilla/5.0",
        },
      });
    });

    it("recusa endereço que não é de um serviço de push conhecido (nunca faz POST para qualquer endereço)", async () => {
      await expect(
        service.subscribe(user, {
          ...subscription,
          endpoint: "https://intranet.exemplo.com/x",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.userPushSubscription.upsert).not.toHaveBeenCalled();
    });

    it("com o push desligado no servidor, responde 503", async () => {
      pushMock.enabled = false;
      await expect(
        service.subscribe(user, subscription),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it("desativa só a inscrição do próprio usuário", async () => {
      await service.unsubscribe(user, ENDPOINT);
      expect(prismaMock.userPushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { endpoint: ENDPOINT, userId: "user-1" },
      });
    });
  });
});
