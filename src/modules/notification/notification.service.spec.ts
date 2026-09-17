import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { PrismaService } from "../../prisma/prisma.service";
import { RecurringAppointmentService } from "../recurring-appointment/recurring-appointment.service";
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
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
  };
  const recurringServiceMock = { findNeedingExtension: vi.fn() };

  const query = { page: 1, limit: 10 };

  beforeEach(async () => {
    vi.clearAllMocks();
    recurringServiceMock.findNeedingExtension.mockResolvedValue([]);
    prismaMock.notification.findMany.mockResolvedValue([]);
    prismaMock.notification.count.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: RecurringAppointmentService,
          useValue: recurringServiceMock,
        },
      ],
    }).compile();

    notificationService = module.get<NotificationService>(NotificationService);
  });

  describe("findAll", () => {
    it("deve criar o aviso da recorrência que precisa de extensão", async () => {
      recurringServiceMock.findNeedingExtension.mockResolvedValue([
        {
          id: "recurring-1",
          generatedUntil: new Date("2026-10-10T14:00:00.000Z"),
        },
      ]);

      await notificationService.findAll(query, COMPANY_ID);

      expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
        data: [
          {
            companyId: COMPANY_ID,
            type: "RECURRING_APPOINTMENT_HORIZON",
            recurringAppointmentId: "recurring-1",
            message: expect.stringContaining("2026-10-10") as unknown,
          },
        ],
      });
    });

    it("não deve duplicar o aviso de uma recorrência já notificada", async () => {
      recurringServiceMock.findNeedingExtension.mockResolvedValue([
        { id: "recurring-1", generatedUntil: null },
      ]);
      prismaMock.notification.findMany.mockResolvedValueOnce([
        { id: "notification-1", recurringAppointmentId: "recurring-1" },
      ]);

      await notificationService.findAll(query, COMPANY_ID);

      expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    });

    it("deve resolver o aviso quando a recorrência não precisa mais de extensão", async () => {
      prismaMock.notification.findMany.mockResolvedValueOnce([
        { id: "notification-1", recurringAppointmentId: "recurring-1" },
      ]);

      await notificationService.findAll(query, COMPANY_ID);

      expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["notification-1"] } },
        data: { resolvedAt: anyDate, updatedAt: anyDate },
      });
    });

    it("não deve gravar nada quando não há mudança", async () => {
      await notificationService.findAll(query, COMPANY_ID);

      expect(prismaMock.notification.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    });

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
