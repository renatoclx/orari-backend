import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { CreatePeopleDto } from "./dto/create-people.dto";
import { PeopleService } from "./people.service";

const anyDate: unknown = expect.any(Date);

describe("PeopleService", () => {
  let peopleService: PeopleService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    people: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };

  const dto: CreatePeopleDto = {
    name: "Maria",
    document: "52998224725",
    birthDate: new Date("1990-05-20"),
    type: "CLIENT",
  };
  const people = { id: "1", ...dto, companyId: COMPANY_ID, deletedAt: null };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeopleService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    peopleService = module.get<PeopleService>(PeopleService);
  });

  describe("create", () => {
    it("deve criar a pessoa na empresa do usuário", async () => {
      prismaMock.people.create.mockResolvedValue(people);

      await expect(peopleService.create(dto, COMPANY_ID)).resolves.toEqual(
        people,
      );
      expect(prismaMock.people.create).toHaveBeenCalledWith({
        data: { ...dto, normalizedName: "maria", companyId: COMPANY_ID },
        omit: { normalizedName: true },
      });
    });

    it("deve lançar ConflictException para documento repetido na empresa", async () => {
      prismaMock.people.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(
        peopleService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("findAll", () => {
    it("deve combinar o escopo da empresa com os filtros", async () => {
      prismaMock.people.findMany.mockResolvedValue([people]);
      prismaMock.people.count.mockResolvedValue(1);

      const result = await peopleService.findAll(
        {
          page: 1,
          limit: 10,
          name: "MÁR",
          document: "52998224725",
          type: "CLIENT",
        },
        COMPANY_ID,
      );

      expect(prismaMock.people.count).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY_ID,
          deletedAt: null,
          normalizedName: { contains: "mar" },
          document: "52998224725",
          type: "CLIENT",
        },
      });
      expect(result).toEqual({ items: [people], total: 1, page: 1, limit: 10 });
    });

    it("não deve filtrar por nome quando ele não é informado", async () => {
      prismaMock.people.findMany.mockResolvedValue([]);
      prismaMock.people.count.mockResolvedValue(0);

      await peopleService.findAll({ page: 1, limit: 10 }, COMPANY_ID);

      expect(prismaMock.people.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          normalizedName: undefined,
        }) as unknown,
      });
    });
  });

  describe("findOne", () => {
    it("deve restringir a busca à empresa do usuário", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);

      await expect(
        peopleService.findOne("1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.people.findFirst).toHaveBeenCalledWith({
        where: { id: "1", companyId: COMPANY_ID, deletedAt: null },
        omit: { normalizedName: true },
      });
    });
  });

  describe("update", () => {
    it("deve atualizar registrando o updatedAt", async () => {
      prismaMock.people.findFirst.mockResolvedValue(people);
      prismaMock.people.update.mockResolvedValue(people);

      await peopleService.update("1", { name: "Maria Conceição" }, COMPANY_ID);

      expect(prismaMock.people.update).toHaveBeenCalledWith({
        where: { id: "1" },
        data: {
          name: "Maria Conceição",
          normalizedName: "maria conceicao",
          updatedAt: anyDate,
        },
        omit: { normalizedName: true },
      });
    });

    it("não deve mexer no nome normalizado quando o nome não muda", async () => {
      prismaMock.people.findFirst.mockResolvedValue(people);

      await peopleService.update("1", { profession: "Médica" }, COMPANY_ID);

      expect(prismaMock.people.update).toHaveBeenCalledWith({
        where: { id: "1" },
        data: { profession: "Médica", updatedAt: anyDate },
        omit: { normalizedName: true },
      });
    });

    it("não deve atualizar pessoa de outra empresa", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);

      await expect(
        peopleService.update("1", { name: "X" }, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.people.update).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("deve excluir logicamente a pessoa", async () => {
      prismaMock.people.findFirst.mockResolvedValue(people);

      await peopleService.remove("1", COMPANY_ID);

      expect(prismaMock.people.update).toHaveBeenCalledWith({
        where: { id: "1" },
        data: { deletedAt: anyDate, updatedAt: anyDate },
      });
    });
  });
});
