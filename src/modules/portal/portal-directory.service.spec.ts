import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyAccessService } from "../company-access/company-access.service";
import {
  DIRECTORY_LIMIT,
  PortalDirectoryService,
} from "./portal-directory.service";

const company = (overrides: object = {}) => ({
  id: "c-1",
  subdomain: "aurora",
  fantasyName: "Studio Aurora Estética",
  corporateReason: "Aurora Serviços LTDA",
  logoUrl: null,
  portalSettings: { segment: "AESTHETICS" },
  addresses: [{ city: { name: "Belo Horizonte", state: { acronym: "MG" } } }],
  ...overrides,
});

describe("PortalDirectoryService", () => {
  const prismaMock = {
    company: { findMany: vi.fn() },
    address: { findFirst: vi.fn() },
  };
  const accessMock = { can: vi.fn() };
  const service = new PortalDirectoryService(
    prismaMock as unknown as PrismaService,
    accessMock as unknown as CompanyAccessService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    accessMock.can.mockResolvedValue(true);
  });

  it("procura só clínicas ativas, de portal ligado e que escolheram aparecer", async () => {
    prismaMock.company.findMany.mockResolvedValue([]);
    await service.search("aurora");
    expect(prismaMock.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          portalSettings: {
            enabled: true,
            listed: true,
            segment: { not: null },
          },
        },
      }),
    );
  });

  it("acha pelo nome sem acentos e sem maiúsculas, e não devolve o id", async () => {
    prismaMock.company.findMany.mockResolvedValue([company()]);
    await expect(service.search("ESTETICA")).resolves.toEqual([
      {
        slug: "aurora",
        name: "Studio Aurora Estética",
        logoUrl: null,
        segment: "AESTHETICS",
        city: "Belo Horizonte - MG",
      },
    ]);
  });

  it("acha também pela razão social; sem nome fantasia, mostra a razão social", async () => {
    prismaMock.company.findMany.mockResolvedValue([
      company({ fantasyName: null, addresses: [] }),
    ]);
    await expect(service.search("servicos")).resolves.toMatchObject([
      { name: "Aurora Serviços LTDA", city: null },
    ]);
  });

  it("deixa de fora quem não bate com o nome e quem está fora do plano", async () => {
    prismaMock.company.findMany.mockResolvedValue([
      company({ id: "c-1", subdomain: "aurora" }),
      company({
        id: "c-2",
        subdomain: "zeta",
        fantasyName: "Zeta Barbearia",
        corporateReason: "Zeta",
      }),
      company({
        id: "c-3",
        subdomain: "aurora-2",
        fantasyName: "Aurora Pilates",
      }),
    ]);
    accessMock.can.mockImplementation((id: string) =>
      Promise.resolve(id !== "c-3"),
    );
    const result = await service.search("aurora");
    expect(result.map((place) => place.slug)).toEqual(["aurora"]);
  });

  it("ordem alfabética e no máximo o limite", async () => {
    prismaMock.company.findMany.mockResolvedValue(
      Array.from({ length: DIRECTORY_LIMIT + 5 }, (_, index) =>
        company({
          id: `c-${index}`,
          subdomain: `s-${index}`,
          fantasyName: `Clínica ${String(100 - index)}`,
        }),
      ),
    );
    const result = await service.search("clinica");
    expect(result).toHaveLength(DIRECTORY_LIMIT);
    expect(result[0].name).toBe("Clínica 100");
  });

  it("cidade do endereço principal da empresa", async () => {
    prismaMock.address.findFirst.mockResolvedValue({
      city: { name: "Contagem", state: { acronym: "MG" } },
    });
    await expect(service.cityOf("c-1")).resolves.toBe("Contagem - MG");
    expect(prismaMock.address.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          peopleId: null,
          isPrincipal: true,
          deletedAt: null,
          companyId: "c-1",
        },
      }),
    );
  });
});
