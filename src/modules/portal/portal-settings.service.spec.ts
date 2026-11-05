import { BadRequestException } from "@nestjs/common";
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
  const directory = { listed: false, segment: null };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.portalSettings.findUnique.mockResolvedValue(null);
  });

  it("clínica sem registro: o padrão (portal desligado, 1 h, 30 dias, 24 h)", async () => {
    prismaMock.portalSettings.findUnique.mockResolvedValue(null);
    await expect(service.find("c-1")).resolves.toEqual(PORTAL_DEFAULTS);
    expect(PORTAL_DEFAULTS).toEqual({
      enabled: false,
      minAdvanceMinutes: 60,
      maxDaysAhead: 30,
      cancelUntilHours: 24,
      listed: false,
      segment: null,
    });
  });

  it("gravar cria na primeira vez e depois substitui", async () => {
    prismaMock.portalSettings.upsert.mockResolvedValue({
      companyId: "c-1",
      ...rules,
      ...directory,
    });
    await expect(service.replace("c-1", rules)).resolves.toEqual({
      ...rules,
      ...directory,
    });
    expect(prismaMock.portalSettings.upsert).toHaveBeenCalledWith({
      where: { companyId: "c-1" },
      create: { companyId: "c-1", ...rules },
      update: { ...rules, updatedAt: expect.any(Date) as Date },
    });
  });

  it("aparecer na busca com o segmento: grava os dois", async () => {
    const dto = { ...rules, listed: true, segment: "AESTHETICS" as const };
    prismaMock.portalSettings.upsert.mockResolvedValue({
      companyId: "c-1",
      ...dto,
    });
    await expect(service.replace("c-1", dto)).resolves.toMatchObject({
      listed: true,
      segment: "AESTHETICS",
    });
  });

  it("aparecer na busca sem segmento (nem gravado antes): 400, sem gravar", async () => {
    await expect(
      service.replace("c-1", { ...rules, listed: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.portalSettings.upsert).not.toHaveBeenCalled();
  });

  it("sem os campos da busca: aproveita o segmento já gravado", async () => {
    prismaMock.portalSettings.findUnique.mockResolvedValue({
      ...rules,
      listed: false,
      segment: "PILATES",
    });
    prismaMock.portalSettings.upsert.mockResolvedValue({
      companyId: "c-1",
      ...rules,
      listed: true,
      segment: "PILATES",
    });
    await service.replace("c-1", { ...rules, listed: true });
    expect(prismaMock.portalSettings.upsert).toHaveBeenCalled();
  });
});
