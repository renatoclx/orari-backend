import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import type { PrismaService } from "../../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { CompanyService } from "../company/company.service";
import {
  AGENDA_BLOCK_HAS_APPOINTMENTS,
  AgendaBlockService,
} from "./agenda-block.service";

const COMPANY_ID = "company-1";
const user = { id: "user-1", companyId: COMPANY_ID } as AuthenticatedUser;
// 09/11/2026 às 09:00 no relógio da empresa (UTC-3).
const NOW = new Date("2026-11-09T12:00:00.000Z");
const dto = { date: "2026-11-10", startTime: "14:00", endTime: "16:30" };

describe("AgendaBlockService", () => {
  const prismaMock = {
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn(prismaMock),
    ),
    agendaBlock: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    appointment: { count: vi.fn() },
  };
  const companyMock = { getTimeZone: vi.fn() };
  const auditMock = { record: vi.fn() };
  const service = new AgendaBlockService(
    prismaMock as unknown as PrismaService,
    companyMock as unknown as CompanyService,
    auditMock as unknown as AuditService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    companyMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");
    prismaMock.agendaBlock.count.mockResolvedValue(0);
    prismaMock.appointment.count.mockResolvedValue(0);
    prismaMock.agendaBlock.create.mockImplementation(
      ({ data }: { data: object }) => ({ id: "block-1", ...data }),
    );
  });

  describe("create", () => {
    it("grava o intervalo em UTC, no relógio da empresa, e audita", async () => {
      const result = await service.create(dto, user, "1.2.3.4", NOW);

      expect(prismaMock.agendaBlock.create).toHaveBeenCalledWith({
        data: {
          companyId: COMPANY_ID,
          startAt: new Date("2026-11-10T17:00:00.000Z"),
          endAt: new Date("2026-11-10T19:30:00.000Z"),
          createdById: "user-1",
        },
      });
      expect(auditMock.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "AGENDA_BLOCK_CREATED",
          entityType: "AGENDA_BLOCK",
          entityId: "block-1",
          ip: "1.2.3.4",
        }),
        prismaMock,
      );
      expect(result.appointments).toBe(0);
    });

    it("recusa fim antes do início, data inexistente e horário que já começou", async () => {
      await expect(
        service.create({ ...dto, endTime: "14:00" }, user, undefined, NOW),
      ).rejects.toThrow("O fim precisa ser depois do início");
      await expect(
        service.create({ ...dto, date: "2026-02-31" }, user, undefined, NOW),
      ).rejects.toThrow("Data inválida");
      await expect(
        service.create(
          { date: "2026-11-09", startTime: "08:00", endTime: "10:00" },
          user,
          undefined,
          NOW,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.agendaBlock.create).not.toHaveBeenCalled();
    });

    it("recusa sobrepor outro bloqueio (409)", async () => {
      prismaMock.agendaBlock.count.mockResolvedValue(1);
      await expect(service.create(dto, user, undefined, NOW)).rejects.toThrow(
        "Já existe um bloqueio neste horário",
      );
    });

    it("com agendamentos no horário, pede a confirmação (409 com a contagem)", async () => {
      prismaMock.appointment.count.mockResolvedValue(2);

      const error = await service
        .create(dto, user, undefined, NOW)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: AGENDA_BLOCK_HAS_APPOINTMENTS,
        appointments: 2,
        message: "Há 2 agendamentos neste horário. Eles continuam marcados.",
      });
      expect(prismaMock.appointment.count).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY_ID,
          status: { not: "CANCELLED" },
          startAt: { lt: new Date("2026-11-10T19:30:00.000Z") },
          endAt: { gt: new Date("2026-11-10T17:00:00.000Z") },
        },
      });
      expect(prismaMock.agendaBlock.create).not.toHaveBeenCalled();
    });

    it("confirmado, bloqueia e devolve quantos agendamentos continuam", async () => {
      prismaMock.appointment.count.mockResolvedValue(1);
      const result = await service.create(
        { ...dto, confirmed: true },
        user,
        undefined,
        NOW,
      );
      expect(result.appointments).toBe(1);
    });
  });

  describe("findAll", () => {
    it("sem período: de hoje em diante, no relógio da empresa", async () => {
      prismaMock.agendaBlock.findMany.mockResolvedValue([]);
      await service.findAll({}, COMPANY_ID, NOW);
      expect(prismaMock.agendaBlock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId: COMPANY_ID,
            endAt: { gt: new Date("2026-11-09T03:00:00.000Z") },
          },
          orderBy: { startAt: "asc" },
        }),
      );
    });

    it("com período: as duas pontas entram", async () => {
      prismaMock.agendaBlock.findMany.mockResolvedValue([]);
      await service.findAll(
        { from: "2026-11-10", to: "2026-11-10" },
        COMPANY_ID,
        NOW,
      );
      expect(prismaMock.agendaBlock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId: COMPANY_ID,
            endAt: { gt: new Date("2026-11-10T03:00:00.000Z") },
            startAt: { lt: new Date("2026-11-11T03:00:00.000Z") },
          },
        }),
      );
    });
  });

  describe("remove", () => {
    it("apaga e audita", async () => {
      prismaMock.agendaBlock.findFirst.mockResolvedValue({
        id: "block-1",
        endAt: new Date("2026-11-10T19:30:00.000Z"),
      });
      await service.remove("block-1", user, "1.2.3.4", NOW);
      expect(prismaMock.agendaBlock.delete).toHaveBeenCalledWith({
        where: { id: "block-1" },
      });
      expect(auditMock.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "AGENDA_BLOCK_REMOVED",
          entityId: "block-1",
        }),
        prismaMock,
      );
    });

    it("de outra empresa: 404; já terminado: 400", async () => {
      prismaMock.agendaBlock.findFirst.mockResolvedValue(null);
      await expect(
        service.remove("block-1", user, undefined, NOW),
      ).rejects.toBeInstanceOf(NotFoundException);

      prismaMock.agendaBlock.findFirst.mockResolvedValue({
        id: "block-1",
        endAt: new Date("2026-11-08T19:30:00.000Z"),
      });
      await expect(
        service.remove("block-1", user, undefined, NOW),
      ).rejects.toThrow("Este bloqueio já terminou e não pode ser desfeito");
      expect(prismaMock.agendaBlock.delete).not.toHaveBeenCalled();
    });
  });
});
