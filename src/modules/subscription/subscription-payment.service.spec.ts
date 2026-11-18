import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID,
  superAdminUser,
} from "../../../test/fixtures/authenticated-users";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { CreateSubscriptionPaymentDto } from "./dto/create-subscription-payment.dto";
import { SubscriptionPaymentService } from "./subscription-payment.service";

const d = (value: string) => new Date(`${value}T00:00:00Z`);

const row = (id: string) => ({
  id,
  companyId: COMPANY_ID,
  amount: { toNumber: () => 89.9 },
  paidAt: d("2026-11-17"),
  method: "PIX",
  periodStart: d("2026-11-24"),
  periodEnd: d("2026-12-23"),
  note: null,
  createdAt: new Date(),
  company: { corporateReason: "Studio Aurora LTDA", fantasyName: "Aurora" },
});

describe("SubscriptionPaymentService", () => {
  let service: SubscriptionPaymentService;
  const tx = {
    subscriptionPayment: { create: vi.fn(), delete: vi.fn() },
    companySubscription: { update: vi.fn() },
  };
  const prismaMock = {
    company: { findUnique: vi.fn() },
    companySubscription: { findUnique: vi.fn() },
    subscriptionPayment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const auditMock = { record: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    tx.subscriptionPayment.create.mockResolvedValue(row("novo"));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionPaymentService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditService, useValue: auditMock },
      ],
    }).compile();
    service = module.get(SubscriptionPaymentService);
  });

  describe("create", () => {
    const dto: CreateSubscriptionPaymentDto = {
      amount: 89.9,
      paidAt: "2026-11-17",
      method: "PIX",
      periodStart: "2026-11-24",
      periodEnd: "2026-12-23",
    };

    it("avança o pago até, guarda o anterior e registra a auditoria", async () => {
      prismaMock.companySubscription.findUnique.mockResolvedValue({
        paidUntil: d("2026-11-23"),
      });
      const item = await service.create(COMPANY_ID, dto, superAdminUser);

      expect(tx.subscriptionPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            previousPaidUntil: d("2026-11-23"),
            createdById: superAdminUser.id,
          }) as unknown,
        }),
      );
      expect(tx.companySubscription.update).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID },
        data: { paidUntil: d("2026-12-23") },
      });
      expect(auditMock.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "SUBSCRIPTION_PAYMENT_CREATED" }),
        tx,
      );
      expect(item).toMatchObject({ companyName: "Aurora", removable: true });
    });

    it("nunca recua o pago até (pagamento de um período antigo)", async () => {
      prismaMock.companySubscription.findUnique.mockResolvedValue({
        paidUntil: d("2027-03-01"),
      });
      await service.create(COMPANY_ID, dto, superAdminUser);
      expect(tx.companySubscription.update).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID },
        data: { paidUntil: d("2027-03-01") },
      });
    });

    it("sem assinatura: 404; período invertido: 400", async () => {
      prismaMock.companySubscription.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.create(COMPANY_ID, dto, superAdminUser),
      ).rejects.toBeInstanceOf(NotFoundException);
      prismaMock.companySubscription.findUnique.mockResolvedValueOnce({
        paidUntil: null,
      });
      await expect(
        service.create(
          COMPANY_ID,
          { ...dto, periodEnd: "2026-11-01" },
          superAdminUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.subscriptionPayment.create).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("exclui o mais recente e devolve o pago até anterior", async () => {
      prismaMock.subscriptionPayment.findFirst.mockResolvedValue({
        id: "ultimo",
        previousPaidUntil: d("2026-11-23"),
      });
      await service.remove(COMPANY_ID, "ultimo", superAdminUser);
      expect(tx.subscriptionPayment.delete).toHaveBeenCalledWith({
        where: { id: "ultimo" },
      });
      expect(tx.companySubscription.update).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID },
        data: { paidUntil: d("2026-11-23") },
      });
    });

    it("outro que não o mais recente: 409; inexistente: 404", async () => {
      prismaMock.subscriptionPayment.findFirst.mockResolvedValue({
        id: "ultimo",
        previousPaidUntil: null,
      });
      prismaMock.subscriptionPayment.count.mockResolvedValueOnce(1);
      await expect(
        service.remove(COMPANY_ID, "antigo", superAdminUser),
      ).rejects.toBeInstanceOf(ConflictException);
      prismaMock.subscriptionPayment.count.mockResolvedValueOnce(0);
      await expect(
        service.remove(COMPANY_ID, "outro", superAdminUser),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.subscriptionPayment.delete).not.toHaveBeenCalled();
    });
  });

  describe("listForCompany", () => {
    it("só o primeiro (mais recente) pode ser excluído; traz a sugestão", async () => {
      prismaMock.company.findUnique.mockResolvedValue({
        timezone: "America/Sao_Paulo",
        subscription: {
          cycle: "MONTHLY",
          price: { toNumber: () => 89.9 },
          discountPercent: null,
          discountUntil: null,
          trialEndsAt: null,
          paidUntil: d("2026-12-23"),
        },
      });
      prismaMock.subscriptionPayment.findMany.mockResolvedValue([
        row("b"),
        row("a"),
      ]);
      const result = await service.listForCompany(
        COMPANY_ID,
        new Date("2026-12-20T15:00:00Z"),
      );
      expect(result.items.map((item) => item.removable)).toEqual([true, false]);
      expect(result.suggestion).toEqual({
        periodStart: "2026-12-24",
        periodEnd: "2027-01-23",
        amount: 89.9,
      });
    });
  });
});
