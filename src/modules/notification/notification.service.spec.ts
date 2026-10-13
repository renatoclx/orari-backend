import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationService } from "./notification.service";

const anyDate: unknown = expect.any(Date);

describe("NotificationService", () => {
  let notificationService: NotificationService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    notification: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };
  const query = { page: 1, limit: 10 };

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.notification.findMany.mockResolvedValue([]);
    prismaMock.notification.count.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    notificationService = module.get<NotificationService>(NotificationService);
  });

  describe("findAll", () => {
    it("deve listar apenas as não resolvidas por padrão", async () => {
      await notificationService.findAll(query, COMPANY_ID);

      expect(prismaMock.notification.count).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID, resolvedAt: null, readAt: undefined },
      });
    });

    it("deve permitir filtrar só as não lidas e incluir resolvidas", async () => {
      await notificationService.findAll(
        { ...query, onlyUnread: true, includeResolved: true },
        COMPANY_ID,
      );

      expect(prismaMock.notification.count).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY_ID,
          resolvedAt: undefined,
          readAt: null,
        },
      });
    });
  });

  describe("markAsRead", () => {
    it("deve marcar a notificação da empresa como lida", async () => {
      prismaMock.notification.findFirst.mockResolvedValue({
        id: "notification-1",
      });

      await notificationService.markAsRead("notification-1", COMPANY_ID);

      expect(prismaMock.notification.update).toHaveBeenCalledWith({
        where: { id: "notification-1" },
        data: { readAt: anyDate, updatedAt: anyDate },
      });
    });

    it("deve lançar NotFoundException para notificação de outra empresa", async () => {
      prismaMock.notification.findFirst.mockResolvedValue(null);

      await expect(
        notificationService.markAsRead("notification-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
