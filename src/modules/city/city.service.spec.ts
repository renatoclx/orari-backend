import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../prisma/prisma.service";
import { CityService } from "./city.service";

describe("CityService", () => {
  let cityService: CityService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    city: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CityService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    cityService = module.get<CityService>(CityService);
  });

  describe("findAll", () => {
    it("deve filtrar as cidades pelo estado informado", async () => {
      const cities = [{ id: "1", name: "Belo Horizonte", stateId: "mg" }];
      prismaMock.city.findMany.mockResolvedValue(cities);
      prismaMock.city.count.mockResolvedValue(853);

      const result = await cityService.findAll({
        page: 1,
        limit: 10,
        stateId: "mg",
      });

      expect(prismaMock.city.findMany).toHaveBeenCalledWith({
        where: { stateId: "mg", normalizedName: undefined },
        omit: { normalizedName: true },
        orderBy: { name: "asc" },
        skip: 0,
        take: 10,
      });
      expect(prismaMock.city.count).toHaveBeenCalledWith({
        where: { stateId: "mg", normalizedName: undefined },
      });
      expect(result).toEqual({ items: cities, total: 853, page: 1, limit: 10 });
    });
  });

  it("deve buscar pelo nome normalizado, ignorando acentos e maiúsculas", async () => {
    prismaMock.city.findMany.mockResolvedValue([]);
    prismaMock.city.count.mockResolvedValue(0);

    await cityService.findAll({ page: 1, limit: 10, name: "SÃO Pau" });

    expect(prismaMock.city.count).toHaveBeenCalledWith({
      where: {
        stateId: undefined,
        normalizedName: { contains: "sao pau" },
      },
    });
  });

  describe("findOne", () => {
    it("deve omitir a coluna de busca da resposta", async () => {
      prismaMock.city.findUnique.mockResolvedValue({ id: "1", name: "X" });

      await cityService.findOne("1");

      expect(prismaMock.city.findUnique).toHaveBeenCalledWith({
        where: { id: "1" },
        omit: { normalizedName: true },
      });
    });

    it("deve lançar NotFoundException quando a cidade não existe", async () => {
      prismaMock.city.findUnique.mockResolvedValue(null);

      await expect(cityService.findOne("1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
