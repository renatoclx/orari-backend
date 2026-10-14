import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateServiceDto } from "./dto/create-service.dto";
import { ServiceService } from "./service.service";

const anyDate: unknown = expect.any(Date);
const omit = { normalizedName: true };

describe("ServiceService", () => {
  let serviceService: ServiceService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    service: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };

  const dto: CreateServiceDto = { name: "Depilação", duration: 30 };
  const service = {
    id: "service-1",
    name: dto.name,
    duration: 30,
    isActive: true,
    companyId: COMPANY_ID,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    serviceService = module.get<ServiceService>(ServiceService);
  });

  describe("create", () => {
    it("deve criar na empresa do usuário com o nome normalizado", async () => {
      prismaMock.service.create.mockResolvedValue(service);

      await serviceService.create(dto, COMPANY_ID);

      expect(prismaMock.service.create).toHaveBeenCalledWith({
        data: { ...dto, normalizedName: "depilacao", companyId: COMPANY_ID },
        omit,
      });
    });

    it("deve lançar ConflictException para nome repetido na empresa", async () => {
      prismaMock.service.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(
        serviceService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("findAll", () => {
    it("deve combinar empresa, status e busca por nome", async () => {
      prismaMock.service.findMany.mockResolvedValue([service]);
      prismaMock.service.count.mockResolvedValue(1);

      await serviceService.findAll(
        { page: 1, limit: 10, name: "DEPILAÇÃO", isActive: true },
        COMPANY_ID,
      );

      expect(prismaMock.service.count).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY_ID,
          deletedAt: null,
          isActive: true,
          normalizedName: { contains: "depilacao" },
        },
      });
    });
  });

  describe("findActive", () => {
    it("deve retornar o serviço ativo", async () => {
      prismaMock.service.findFirst.mockResolvedValue(service);

      await expect(
        serviceService.findActive("service-1", COMPANY_ID),
      ).resolves.toEqual(service);
    });

    it("deve recusar serviço inativo", async () => {
      prismaMock.service.findFirst.mockResolvedValue({
        ...service,
        isActive: false,
      });

      await expect(
        serviceService.findActive("service-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("deve recusar serviço de outra empresa", async () => {
      prismaMock.service.findFirst.mockResolvedValue(null);

      await expect(
        serviceService.findActive("service-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("update", () => {
    it("deve sincronizar o nome normalizado quando o nome muda", async () => {
      prismaMock.service.findFirst.mockResolvedValue(service);

      await serviceService.update(
        "service-1",
        { name: "Massagem" },
        COMPANY_ID,
      );

      expect(prismaMock.service.update).toHaveBeenCalledWith({
        where: { id: "service-1" },
        data: {
          name: "Massagem",
          normalizedName: "massagem",
          updatedAt: anyDate,
        },
        omit,
      });
    });
  });

  describe("remove", () => {
    const relations = (counts: Partial<Record<string, number>> = {}) => ({
      _count: {
        appointments: 0,
        recurringAppointments: 0,
        planItems: 0,
        ...counts,
      },
    });

    beforeEach(() => {
      prismaMock.service.findFirst.mockResolvedValue(service);
      prismaMock.service.findUniqueOrThrow.mockResolvedValue(relations());
    });

    it("deve contar agendamentos, recorrências e itens de plano, sem filtrar status", async () => {
      await serviceService.remove("service-1", COMPANY_ID);

      expect(prismaMock.service.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "service-1" },
        select: {
          _count: {
            select: {
              appointments: true,
              recurringAppointments: true,
              planItems: true,
            },
          },
        },
      });
    });

    it.each([
      ["agendamentos", { appointments: 1 }],
      ["recorrências", { recurringAppointments: 2 }],
      ["itens de plano", { planItems: 1 }],
    ])(
      "deve recusar com 409 e não alterar nada quando há %s",
      async (_name, counts) => {
        prismaMock.service.findUniqueOrThrow.mockResolvedValue(
          relations(counts),
        );

        await expect(
          serviceService.remove("service-1", COMPANY_ID),
        ).rejects.toThrow(
          "O serviço possui agendamentos, recorrências ou planos vinculados. Inative-o em vez de excluir.",
        );
        await expect(
          serviceService.remove("service-1", COMPANY_ID),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prismaMock.service.update).not.toHaveBeenCalled();
      },
    );

    it("deve responder 404 para serviço inexistente ou de outra empresa, sem contar relações", async () => {
      prismaMock.service.findFirst.mockResolvedValue(null);

      await expect(
        serviceService.remove("service-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.service.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prismaMock.service.update).not.toHaveBeenCalled();
    });

    it("deve excluir logicamente o serviço sem relacionamentos", async () => {
      await serviceService.remove("service-1", COMPANY_ID);

      expect(prismaMock.service.update).toHaveBeenCalledWith({
        where: { id: "service-1" },
        data: { deletedAt: anyDate, updatedAt: anyDate },
      });
    });
  });
});
