import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ServiceService } from "../service/service.service";
import { CreatePlanDto } from "./dto/create-plan.dto";
import { PlanService } from "./plan.service";

const anyDate: unknown = expect.any(Date);

describe("PlanService", () => {
  let planService: PlanService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    plan: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };
  const serviceServiceMock = { findActive: vi.fn() };

  const dto: CreatePlanDto = {
    name: "Pilates + Fisio",
    monthlyPrice: 450,
    serviceIds: ["service-1", "service-2"],
    periods: [
      { months: 3, discountPercent: 10, monthlyDiscountPercent: 5 },
      { months: 6, discountPercent: 15, monthlyDiscountPercent: 8 },
    ],
  };

  // Como o banco devolve: itens com o serviço aninhado.
  const stored = {
    id: "plan-1",
    companyId: COMPANY_ID,
    name: "Pilates + Fisio",
    description: null,
    monthlyPrice: 450,
    isActive: true,
    createdAt: new Date("2026-10-07"),
    updatedAt: null,
    items: [
      { service: { id: "service-1", name: "Fisioterapia", isActive: true } },
      { service: { id: "service-2", name: "Pilates", isActive: true } },
    ],
    periods: dto.periods,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.plan.create.mockResolvedValue(stored);
    prismaMock.plan.update.mockResolvedValue(stored);
    prismaMock.plan.findFirst.mockResolvedValue(stored);
    serviceServiceMock.findActive.mockResolvedValue({ isActive: true });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ServiceService, useValue: serviceServiceMock },
      ],
    }).compile();

    planService = module.get<PlanService>(PlanService);
  });

  describe("create", () => {
    it("deve gravar o plano com itens, períodos e a coluna de busca", async () => {
      await planService.create(dto, COMPANY_ID);

      expect(prismaMock.plan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: "Pilates + Fisio",
            monthlyPrice: 450,
            normalizedName: "pilates + fisio",
            companyId: COMPANY_ID,
            items: {
              create: [{ serviceId: "service-1" }, { serviceId: "service-2" }],
            },
            periods: { create: dto.periods },
          },
        }),
      );
    });

    it("deve devolver os serviços no lugar dos itens", async () => {
      const result = await planService.create(dto, COMPANY_ID);

      expect(result.services).toEqual([
        { id: "service-1", name: "Fisioterapia", isActive: true },
        { id: "service-2", name: "Pilates", isActive: true },
      ]);
      expect(result).not.toHaveProperty("items");
    });

    it("deve validar cada serviço na empresa", async () => {
      await planService.create(dto, COMPANY_ID);

      expect(serviceServiceMock.findActive).toHaveBeenCalledWith(
        "service-1",
        COMPANY_ID,
      );
      expect(serviceServiceMock.findActive).toHaveBeenCalledWith(
        "service-2",
        COMPANY_ID,
      );
    });

    it("deve recusar serviço inativo sem gravar", async () => {
      serviceServiceMock.findActive.mockRejectedValueOnce(
        new ConflictException("Serviço inativo"),
      );

      await expect(planService.create(dto, COMPANY_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prismaMock.plan.create).not.toHaveBeenCalled();
    });

    it("deve recusar dois períodos com o mesmo número de meses", async () => {
      await expect(
        planService.create(
          {
            ...dto,
            periods: [
              { months: 3, discountPercent: 10, monthlyDiscountPercent: 5 },
              { months: 3, discountPercent: 12, monthlyDiscountPercent: 6 },
            ],
          },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.plan.create).not.toHaveBeenCalled();
    });

    it("deve aceitar plano sem períodos", async () => {
      await planService.create({ ...dto, periods: undefined }, COMPANY_ID);

      expect(prismaMock.plan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ periods: { create: [] } }) as unknown,
        }),
      );
    });

    it("deve lançar ConflictException para nome repetido na empresa", async () => {
      prismaMock.plan.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(planService.create(dto, COMPANY_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe("findAll", () => {
    it("deve filtrar por empresa, status e nome sem acento", async () => {
      prismaMock.plan.findMany.mockResolvedValue([stored]);
      prismaMock.plan.count.mockResolvedValue(1);

      const result = await planService.findAll(
        { page: 1, limit: 10, name: "Fisió", isActive: true },
        COMPANY_ID,
      );

      expect(prismaMock.plan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId: COMPANY_ID,
            isActive: true,
            normalizedName: { contains: "fisio" },
          },
        }),
      );
      expect(result.total).toBe(1);
      expect(result.items[0].services).toHaveLength(2);
    });
  });

  describe("findOne", () => {
    it("deve lançar NotFoundException para plano de outra empresa", async () => {
      prismaMock.plan.findFirst.mockResolvedValueOnce(null);

      await expect(
        planService.findOne("plan-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("update", () => {
    it("deve substituir serviços e períodos quando informados", async () => {
      const periods = [
        { months: 12, discountPercent: 20, monthlyDiscountPercent: 12 },
      ];

      await planService.update(
        "plan-1",
        { serviceIds: ["service-3"], periods },
        COMPANY_ID,
      );

      expect(prismaMock.plan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "plan-1" },
          data: {
            items: { deleteMany: {}, create: [{ serviceId: "service-3" }] },
            periods: { deleteMany: {}, create: periods },
            updatedAt: anyDate,
          },
        }),
      );
    });

    it("não deve tocar nas listas nem nos serviços quando não informados", async () => {
      await planService.update("plan-1", { isActive: false }, COMPANY_ID);

      expect(serviceServiceMock.findActive).not.toHaveBeenCalled();
      expect(prismaMock.plan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isActive: false, updatedAt: anyDate },
        }),
      );
    });

    it("deve atualizar a coluna de busca quando o nome muda", async () => {
      await planService.update("plan-1", { name: "Plano Ágil" }, COMPANY_ID);

      expect(prismaMock.plan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: "Plano Ágil",
            normalizedName: "plano agil",
            updatedAt: anyDate,
          },
        }),
      );
    });

    it("deve permitir reativar um plano", async () => {
      await expect(
        planService.update("plan-1", { isActive: true }, COMPANY_ID),
      ).resolves.toBeDefined();
    });

    it("deve lançar NotFoundException para plano de outra empresa", async () => {
      prismaMock.plan.findFirst.mockResolvedValueOnce(null);

      await expect(
        planService.update("plan-1", { isActive: false }, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.plan.update).not.toHaveBeenCalled();
    });
  });
});
