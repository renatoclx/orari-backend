import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaymentMethodService } from "./payment-method.service";

const COMPANY_ID = "company-1";
const anyDate: unknown = expect.any(Date);
const omit = { normalizedName: true };

describe("PaymentMethodService", () => {
  let service: PaymentMethodService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    paymentMethod: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };
  const stored = { id: "pm-1", name: "Pix", companyId: COMPANY_ID };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentMethodService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(PaymentMethodService);
  });

  describe("findAll", () => {
    beforeEach(() => {
      prismaMock.paymentMethod.findMany.mockResolvedValue([stored]);
      prismaMock.paymentMethod.count.mockResolvedValue(1);
    });

    it.each([
      [undefined, undefined],
      [true, null],
      [false, { not: null }],
    ])(
      "com isActive=%s filtra deletedAt por %j",
      async (isActive, deletedAt) => {
        await service.findAll({ page: 1, limit: 10, isActive }, COMPANY_ID);

        expect(prismaMock.paymentMethod.count).toHaveBeenCalledWith({
          where: {
            companyId: COMPANY_ID,
            deletedAt,
            normalizedName: undefined,
          },
        });
      },
    );
  });

  describe("restore", () => {
    it("deve reativar o método inativado", async () => {
      prismaMock.paymentMethod.findFirst.mockResolvedValue({
        deletedAt: new Date(),
      });
      prismaMock.paymentMethod.update.mockResolvedValue(stored);

      await expect(service.restore("pm-1", COMPANY_ID)).resolves.toEqual(
        stored,
      );
      expect(prismaMock.paymentMethod.findFirst).toHaveBeenCalledWith({
        where: { id: "pm-1", companyId: COMPANY_ID },
        select: { deletedAt: true },
      });
      expect(prismaMock.paymentMethod.update).toHaveBeenCalledWith({
        where: { id: "pm-1" },
        data: { deletedAt: null, updatedAt: anyDate },
        omit,
      });
    });

    it("deve lançar NotFoundException para método de outra empresa", async () => {
      prismaMock.paymentMethod.findFirst.mockResolvedValue(null);

      await expect(service.restore("pm-1", COMPANY_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prismaMock.paymentMethod.update).not.toHaveBeenCalled();
    });

    it("deve lançar ConflictException quando o método já está ativo", async () => {
      prismaMock.paymentMethod.findFirst.mockResolvedValue({ deletedAt: null });

      await expect(service.restore("pm-1", COMPANY_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prismaMock.paymentMethod.update).not.toHaveBeenCalled();
    });

    it("deve lançar ConflictException quando o nome já está com outro ativo", async () => {
      prismaMock.paymentMethod.findFirst.mockResolvedValue({
        deletedAt: new Date(),
      });
      prismaMock.paymentMethod.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(service.restore("pm-1", COMPANY_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
