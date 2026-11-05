import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import {
  PORTAL_DEFAULTS,
  PortalSettingsService,
} from "./portal-settings.service";

describe("PortalSettingsService", () => {
  const prismaMock = {
    portalSettings: { findUnique: vi.fn(), upsert: vi.fn() },
  };
  const service = new PortalSettingsService(
    prismaMock as unknown as PrismaService,
  );
  const rules = {
    enabled: true,
    minAdvanceMinutes: 30,
    maxDaysAhead: 60,
    cancelUntilHours: 6,
  };

  beforeEach(() => vi.clearAllMocks());

  it("clínica sem registro: o padrão (portal desligado, 1 h, 30 dias, 24 h)", async () => {
    prismaMock.portalSettings.findUnique.mockResolvedValue(null);
    await expect(service.find("c-1")).resolves.toEqual(PORTAL_DEFAULTS);
    expect(PORTAL_DEFAULTS).toEqual({
      enabled: false,
      minAdvanceMinutes: 60,
      maxDaysAhead: 30,
      cancelUntilHours: 24,
    });
  });

  it("gravar cria na primeira vez e depois substitui", async () => {
    prismaMock.portalSettings.upsert.mockResolvedValue({
      companyId: "c-1",
      ...rules,
    });
    await expect(service.replace("c-1", rules)).resolves.toEqual(rules);
    expect(prismaMock.portalSettings.upsert).toHaveBeenCalledWith({
      where: { companyId: "c-1" },
      create: { companyId: "c-1", ...rules },
      update: { ...rules, updatedAt: expect.any(Date) as Date },
    });
  });
});
