import {
  BadRequestException,
  ForbiddenException,
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
import type { UpdateSubscriptionDto } from "./dto/update-subscription.dto";
import { SubscriptionService } from "./subscription.service";

const d = (value: string) => new Date(`${value}T00:00:00Z`);
// Meio-dia em Brasília: o "hoje" da empresa é o mesmo dia.
const NOW = new Date("2026-12-15T15:00:00Z");

const row = (extra: Record<string, unknown> = {}) => ({
  plan: "PLUS",
  cycle: "MONTHLY",
  extraProfessionals: 1,
  anamnesisAddon: false,
  price: { toNumber: () => 106.8 },
  discountPercent: null,
  discountUntil: null,
  trialEndsAt: null,
  paidUntil: d("2027-01-10"),
  canceledAt: null,
  ...extra,
});

describe("SubscriptionService", () => {
  let service: SubscriptionService;
  const tx = { companySubscription: { upsert: vi.fn() } };
  const prismaMock = {
    company: { findUnique: vi.fn(), findMany: vi.fn() },
    companySubscription: { findUnique: vi.fn() },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const auditMock = { record: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditService, useValue: auditMock },
      ],
    }).compile();
    service = module.get(SubscriptionService);
  });

  describe("findOne", () => {
    it("traz as datas em texto e a situação calculada no fuso da empresa", async () => {
      prismaMock.company.findUnique.mockResolvedValue({
        timezone: "America/Sao_Paulo",
        subscription: row(),
      });
      await expect(service.findOne(COMPANY_ID, NOW)).resolves.toMatchObject({
        plan: "PLUS",
        price: 106.8,
        paidUntil: "2027-01-10",
        status: "ACTIVE",
        readOnly: false,
        endsAt: "2027-01-10",
      });
    });

    it("sem assinatura: nulo; empresa inexistente: 404", async () => {
      prismaMock.company.findUnique.mockResolvedValueOnce({
        timezone: "America/Sao_Paulo",
        subscription: null,
      });
      await expect(service.findOne(COMPANY_ID)).resolves.toBeNull();
      prismaMock.company.findUnique.mockResolvedValueOnce(null);
      await expect(service.findOne(COMPANY_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("replace", () => {
    const dto: UpdateSubscriptionDto = {
      plan: "ESSENTIAL",
      cycle: "MONTHLY",
      extraProfessionals: 0,
      anamnesisAddon: false,
      price: 44.9,
      trialEndsAt: "2026-12-22",
      discountUntil: "2027-03-01",
    };

    beforeEach(() => {
      prismaMock.company.findUnique.mockResolvedValue({
        timezone: "America/Sao_Paulo",
        subscription: null,
      });
    });

    it("grava as datas e registra a auditoria na empresa do SUPER_ADMIN", async () => {
      await service.replace(COMPANY_ID, dto, superAdminUser, "1.1.1.1");
      const update: unknown = expect.objectContaining({
        trialEndsAt: d("2026-12-22"),
        paidUntil: null,
        // "Até quando" sem percentual é descartado.
        discountPercent: null,
        discountUntil: null,
      });
      expect(tx.companySubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: COMPANY_ID }, update }),
      );
      expect(auditMock.record).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: superAdminUser.companyId,
          action: "SUBSCRIPTION_CHANGED",
          entityId: COMPANY_ID,
        }),
        tx,
      );
    });

    it("exige o fim do teste ou o pago até", async () => {
      await expect(
        service.replace(
          COMPANY_ID,
          { ...dto, trialEndsAt: null },
          superAdminUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.companySubscription.upsert).not.toHaveBeenCalled();
    });
  });

  describe("assertWritable", () => {
    const stored = (extra: Record<string, unknown>) =>
      prismaMock.companySubscription.findUnique.mockResolvedValue({
        trialEndsAt: null,
        paidUntil: null,
        canceledAt: null,
        company: { timezone: "America/Sao_Paulo" },
        ...extra,
      });

    it("sem assinatura não restringe", async () => {
      prismaMock.companySubscription.findUnique.mockResolvedValue(null);
      await expect(service.assertWritable(COMPANY_ID)).resolves.toBeUndefined();
    });

    it("teste vencido: 403 com o código SUBSCRIPTION_READ_ONLY", async () => {
      stored({ trialEndsAt: d("2020-01-01") });
      const error = await service
        .assertWritable(COMPANY_ID)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: "SUBSCRIPTION_READ_ONLY",
      });
    });

    it("em atraso dentro da tolerância ainda grava", async () => {
      stored({ paidUntil: localYesterday() });
      await expect(service.assertWritable(COMPANY_ID)).resolves.toBeUndefined();
    });
  });
});

// Ontem no fuso de Brasília (o teste roda com o relógio de verdade).
function localYesterday(): Date {
  const today = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) +
      "T00:00:00Z",
  );
  return new Date(today.getTime() - 24 * 60 * 60 * 1000);
}
