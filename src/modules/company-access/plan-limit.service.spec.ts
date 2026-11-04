import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../../generated/prisma/client";
import { PlanLimitService } from "./plan-limit.service";

describe("PlanLimitService", () => {
  const service = new PlanLimitService();
  // Ordem das chamadas: a trava precisa vir antes da contagem.
  const calls: string[] = [];
  const tx = {
    $queryRaw: vi.fn(() => {
      calls.push("lock");
      return Promise.resolve([]);
    }),
    companyLimit: { findUnique: vi.fn() },
    people: {
      count: vi.fn(() => {
        calls.push("count");
        return Promise.resolve(0);
      }),
    },
    user: {
      count: vi.fn(() => {
        calls.push("count");
        return Promise.resolve(0);
      }),
    },
  };
  const client = tx as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    tx.companyLimit.findUnique.mockResolvedValue({
      maxProfessionals: 3,
      maxAdmins: 1,
    });
    tx.people.count.mockImplementation(() => {
      calls.push("count");
      return Promise.resolve(2);
    });
    tx.user.count.mockImplementation(() => {
      calls.push("count");
      return Promise.resolve(0);
    });
  });

  it("abaixo do limite, passa", async () => {
    await expect(
      service.assertWithinLimit("professionals", "company-1", client),
    ).resolves.toBeUndefined();
  });

  it("trava a linha da empresa antes de contar", async () => {
    await service.assertWithinLimit("professionals", "company-1", client);
    expect(calls[0]).toBe("lock");
    expect(calls).toContain("count");
  });

  it("conta só os profissionais ativos da empresa", async () => {
    await service.assertWithinLimit("professionals", "company-1", client);
    expect(tx.people.count).toHaveBeenCalledWith({
      where: { companyId: "company-1", type: "PROFESSIONAL", deletedAt: null },
    });
  });

  it("no limite, recusa com PLAN_LIMIT_REACHED, o limite e o uso", async () => {
    tx.people.count.mockResolvedValue(3);

    const error = await service
      .assertWithinLimit("professionals", "company-1", client)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      statusCode: 403,
      code: "PLAN_LIMIT_REACHED",
      resource: "professionals",
      limit: 3,
      used: 3,
    });
  });

  it("administradores: conta os ADMIN ativos e usa maxAdmins", async () => {
    tx.user.count.mockResolvedValue(1);

    await expect(
      service.assertWithinLimit("admins", "company-1", client),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.user.count).toHaveBeenCalledWith({
      where: { companyId: "company-1", type: "ADMIN", deletedAt: null },
    });
  });

  it("sem registro de limites, vale o modelo padrão (3 e 1)", async () => {
    tx.companyLimit.findUnique.mockResolvedValue(null);
    tx.people.count.mockResolvedValue(3);

    await expect(
      service.assertWithinLimit("professionals", "company-1", client),
    ).rejects.toMatchObject({ response: { limit: 3 } });
  });
});
