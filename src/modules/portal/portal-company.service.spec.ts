import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyAccessService } from "../company-access/company-access.service";
import { PortalCompanyService } from "./portal-company.service";

describe("PortalCompanyService", () => {
  const prismaMock = { company: { findUnique: vi.fn() } };
  const accessMock = { can: vi.fn() };
  const service = new PortalCompanyService(
    prismaMock as unknown as PrismaService,
    accessMock as unknown as CompanyAccessService,
  );
  const company = (overrides: object = {}) => ({
    id: "c-1",
    fantasyName: "Studio Aurora",
    corporateReason: "Aurora LTDA",
    logoUrl: null,
    timezone: "America/Sao_Paulo",
    isActive: true,
    portalSettings: {
      enabled: true,
      minAdvanceMinutes: 120,
      maxDaysAhead: 15,
      cancelUntilHours: 12,
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    accessMock.can.mockResolvedValue(true);
  });

  it("portal ligado e no plano: devolve a clínica e as regras", async () => {
    prismaMock.company.findUnique.mockResolvedValue(company());
    await expect(service.findBySlug("aurora")).resolves.toEqual({
      id: "c-1",
      name: "Studio Aurora",
      logoUrl: null,
      timezone: "America/Sao_Paulo",
      rules: { minAdvanceMinutes: 120, maxDaysAhead: 15, cancelUntilHours: 12 },
    });
    expect(accessMock.can).toHaveBeenCalledWith("c-1", "client-portal", "view");
  });

  it.each([
    ["inexistente", null],
    ["inativa", company({ isActive: false })],
    [
      "sem regras gravadas (portal nunca ligado)",
      company({ portalSettings: null }),
    ],
    [
      "com o portal desligado",
      company({
        portalSettings: { ...company().portalSettings, enabled: false },
      }),
    ],
  ])("clínica %s: 404", async (_, value) => {
    prismaMock.company.findUnique.mockResolvedValue(value);
    await expect(service.findBySlug("aurora")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("portal fora do plano: 404", async () => {
    prismaMock.company.findUnique.mockResolvedValue(company());
    accessMock.can.mockResolvedValue(false);
    await expect(service.findBySlug("aurora")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
