import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../prisma/prisma.service";
import { StateService } from "./state.service";

describe("StateService", () => {
  let stateService: StateService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    state: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StateService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    stateService = module.get<StateService>(StateService);
  });

  describe("findAll", () => {
    it("deve retornar os estados paginados e ordenados por nome", async () => {
      const states = [{ id: "1", name: "Acre", acronym: "AC" }];
      prismaMock.state.findMany.mockResolvedValue(states);
      prismaMock.state.count.mockResolvedValue(27);

      const result = await stateService.findAll({ page: 2, limit: 10 });

      expect(prismaMock.state.findMany).toHaveBeenCalledWith({
        orderBy: { name: "asc" },
        skip: 10,
        take: 10,
      });
      expect(result).toEqual({ items: states, total: 27, page: 2, limit: 10 });
    });
  });

  describe("findOne", () => {
    it("deve retornar o estado encontrado", async () => {
      const state = { id: "1", name: "Acre", acronym: "AC" };
      prismaMock.state.findUnique.mockResolvedValue(state);

      await expect(stateService.findOne("1")).resolves.toEqual(state);
    });

    it("deve lançar NotFoundException quando o estado não existe", async () => {
      prismaMock.state.findUnique.mockResolvedValue(null);

      await expect(stateService.findOne("1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
