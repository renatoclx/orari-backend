import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import { PortalCatalogService } from "./portal-catalog.service";

describe("PortalCatalogService", () => {
  const prismaMock = { service: { findMany: vi.fn() } };
  const service = new PortalCatalogService(
    prismaMock as unknown as PrismaService,
  );

  it("só serviços ativos com profissional ativo; preço vira número e a lista de profissionais é achatada", async () => {
    prismaMock.service.findMany.mockResolvedValue([
      {
        id: "s-1",
        name: "Corte",
        description: null,
        duration: 30,
        price: { toString: () => "45.5", valueOf: () => 45.5 },
        color: null,
        professionals: [
          { people: { id: "p-1", name: "Rafa", photoUrl: null } },
        ],
      },
    ]);

    const [corte] = await service.services("c-1");

    expect(corte).toEqual({
      id: "s-1",
      name: "Corte",
      description: null,
      duration: 30,
      price: 45.5,
      color: null,
      professionals: [{ id: "p-1", name: "Rafa", photoUrl: null }],
    });
    const [args] = prismaMock.service.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(args.where).toMatchObject({
      companyId: "c-1",
      isActive: true,
      deletedAt: null,
      professionals: {
        some: { people: { type: "PROFESSIONAL", deletedAt: null } },
      },
    });
  });
});
