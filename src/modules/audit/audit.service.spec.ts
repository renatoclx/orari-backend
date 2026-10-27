import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "./audit.service";

// Tipado como unknown para não propagar o any do matcher (mesmo padrão do anyDate).
const containing = (expected: object): unknown =>
  expect.objectContaining(expected);

describe("AuditService", () => {
  let service: AuditService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    auditLog: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get(AuditService);
  });

  describe("record", () => {
    const entry = {
      companyId: COMPANY_ID,
      userId: "user-1",
      action: "USER_LINK_CHANGED" as const,
      entityType: "USER",
      entityId: "user-2",
    };

    it("grava o registro pelo cliente padrão", async () => {
      await service.record(entry);

      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({ data: entry });
    });

    it("grava pelo cliente da transação quando informado", async () => {
      const tx = { auditLog: { create: vi.fn() } };

      await service.record(entry, tx as never);

      expect(tx.auditLog.create).toHaveBeenCalledWith({ data: entry });
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });

    it("propaga o erro: a ação não pode seguir sem o registro", async () => {
      prismaMock.auditLog.create.mockRejectedValue(new Error("db fora"));

      await expect(service.record(entry)).rejects.toThrow("db fora");
    });
  });

  describe("findAll", () => {
    const query = { page: 2, limit: 5 };

    it("lista só a empresa informada, da mais recente para a mais antiga", async () => {
      prismaMock.auditLog.findMany.mockResolvedValue([{ id: "a" }]);
      prismaMock.auditLog.count.mockResolvedValue(6);

      const result = await service.findAll(query, COMPANY_ID);

      expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith({
        where: containing({ companyId: COMPANY_ID }),
        orderBy: { createdAt: "desc" },
        skip: 5,
        take: 5,
      });
      expect(result).toEqual({
        items: [{ id: "a" }],
        total: 6,
        page: 2,
        limit: 5,
      });
    });

    it("aplica os filtros e o período", async () => {
      const from = new Date("2026-10-01T00:00:00Z");
      const to = new Date("2026-10-31T23:59:59Z");

      await service.findAll(
        {
          ...query,
          clientId: "client-1",
          userId: "user-1",
          action: "USER_LINK_CHANGED",
          from,
          to,
        },
        COMPANY_ID,
      );

      expect(prismaMock.auditLog.count).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY_ID,
          clientId: "client-1",
          userId: "user-1",
          action: "USER_LINK_CHANGED",
          createdAt: { gte: from, lte: to },
        },
      });
    });

    it("sem período, não filtra a data", async () => {
      await service.findAll(query, COMPANY_ID);

      expect(prismaMock.auditLog.count).toHaveBeenCalledWith({
        where: containing({ createdAt: undefined }),
      });
    });
  });
});
