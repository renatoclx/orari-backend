import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CommissionClosingService } from "../commission/commission-closing.service";
import type { CommissionService } from "../commission/commission.service";
import type { CompanyAccessService } from "../company-access/company-access.service";
import type { CompanyService } from "../company/company.service";
import { ProfessionalCommissionService } from "./professional-commission.service";
import { ProfessionalLinkService } from "./professional-link.service";

const user = {
  id: "user-1",
  companyId: "company-1",
  type: "PROFESSIONAL",
} as AuthenticatedUser;
// 12/11/2026 às 10:00 no relógio da empresa (UTC-3).
const NOW = new Date("2026-11-12T13:00:00.000Z");

describe("ProfessionalCommissionService", () => {
  const prismaMock = {
    user: { findFirst: vi.fn() },
    people: { findFirst: vi.fn() },
  };
  const companyMock = { getTimeZone: vi.fn() };
  const accessMock = { can: vi.fn() };
  const commissionsMock = { summary: vi.fn(), list: vi.fn() };
  const closingsMock = { list: vi.fn(), receipt: vi.fn() };
  const service = new ProfessionalCommissionService(
    prismaMock as unknown as PrismaService,
    companyMock as unknown as CompanyService,
    accessMock as unknown as CompanyAccessService,
    new ProfessionalLinkService(prismaMock as unknown as PrismaService),
    commissionsMock as unknown as CommissionService,
    closingsMock as unknown as CommissionClosingService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    companyMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");
    accessMock.can.mockResolvedValue(true);
    prismaMock.user.findFirst.mockResolvedValue({
      people: { id: "pro-1", type: "PROFESSIONAL", deletedAt: null },
    });
    prismaMock.people.findFirst.mockResolvedValue({ receivesCommission: true });
  });

  describe("summary", () => {
    it("pede o mês inteiro só do profissional do vínculo e devolve só os totais dele", async () => {
      commissionsMock.summary.mockResolvedValue({
        count: 9,
        base: "999.00",
        amount: "999.00",
        clientPaid: "50.00",
        advanced: "30.00",
        toPay: "120.00",
        byProfessional: [
          {
            id: "pro-1",
            name: "Camila",
            count: 3,
            base: "300.00",
            amount: "90.00",
            clientPaid: "100.00",
            advanced: "30.00",
            toPay: "120.00",
          },
        ],
      });

      const result = await service.summary(user, { month: "2026-02" }, NOW);

      expect(commissionsMock.summary).toHaveBeenCalledWith(
        { from: "2026-02-01", to: "2026-02-28", professionalId: "pro-1" },
        "company-1",
        NOW,
      );
      expect(result).toEqual({
        month: "2026-02",
        receivesCommission: true,
        count: 3,
        base: "300.00",
        amount: "90.00",
        advanced: "30.00",
        toPay: "120.00",
      });
      expect(result).not.toHaveProperty("clientPaid");
    });

    it("sem o mês, usa o atual no relógio da empresa", async () => {
      commissionsMock.summary.mockResolvedValue({
        advanced: "0.00",
        toPay: "0.00",
        byProfessional: [],
      });
      // 01:00 UTC de 1º/12 ainda é 30/11 em São Paulo.
      const result = await service.summary(
        user,
        {},
        new Date("2026-12-01T01:00:00.000Z"),
      );
      expect(result.month).toBe("2026-11");
      expect(commissionsMock.summary).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-11-01", to: "2026-11-30" }),
        "company-1",
        expect.any(Date),
      );
    });

    it("sem atendimento no mês, zera os totais e mantém o em aberto", async () => {
      commissionsMock.summary.mockResolvedValue({
        advanced: "10.00",
        toPay: "40.00",
        byProfessional: [],
      });
      const result = await service.summary(user, { month: "2026-11" }, NOW);
      expect(result).toMatchObject({
        count: 0,
        amount: "0.00",
        advanced: "10.00",
        toPay: "40.00",
      });
    });

    it("avisa quando o profissional não recebe comissão", async () => {
      commissionsMock.summary.mockResolvedValue({
        advanced: "0.00",
        toPay: "0.00",
        byProfessional: [],
      });
      prismaMock.people.findFirst.mockResolvedValue({
        receivesCommission: false,
      });
      const result = await service.summary(user, { month: "2026-11" }, NOW);
      expect(result.receivesCommission).toBe(false);
    });

    it("recusa quando a empresa não tem a funcionalidade comissões", async () => {
      accessMock.can.mockResolvedValue(false);
      await expect(
        service.summary(user, { month: "2026-11" }, NOW),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(accessMock.can).toHaveBeenCalledWith(
        "company-1",
        "commissions",
        "view",
      );
      expect(commissionsMock.summary).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("devolve cada comissão sem o que o cliente pagou", async () => {
      commissionsMock.list.mockResolvedValue({
        items: [
          {
            id: "k1",
            appointment: {
              id: "a1",
              startAt: NOW,
              client: { id: "c1", name: "Ana" },
              service: { id: "s1", name: "Corte" },
              fromPackage: true,
            },
            professional: { id: "pro-1", name: "Camila" },
            baseAmount: "100.00",
            type: "PERCENTAGE",
            rate: "30.00",
            amount: "30.00",
            clientPaid: "100.00",
            closing: { id: "f1", number: 7 },
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      });

      const result = await service.list(
        user,
        Object.assign({ page: 1, limit: 10 }, { month: "2026-11" }),
        NOW,
      );

      expect(commissionsMock.list).toHaveBeenCalledWith(
        {
          page: 1,
          limit: 10,
          from: "2026-11-01",
          to: "2026-11-30",
          professionalId: "pro-1",
        },
        "company-1",
        NOW,
      );
      expect(result.items[0]).toEqual({
        id: "k1",
        startAt: NOW,
        clientName: "Ana",
        serviceName: "Corte",
        fromPackage: true,
        baseAmount: "100.00",
        type: "PERCENTAGE",
        rate: "30.00",
        amount: "30.00",
        closingNumber: 7,
      });
    });
  });

  describe("fechamentos", () => {
    const item = {
      id: "f1",
      number: 7,
      cutoffDate: "2026-11-10",
      paidAt: "2026-11-11",
      paymentMethod: { id: "m1", name: "Pix" },
      commissionTotal: "100.00",
      advanceTotal: "20.00",
      paidAmount: "80.00",
      appointmentsCount: 4,
      createdBy: { id: "u1", name: "Marina" },
      createdAt: NOW,
      cancelledAt: null,
    };

    it("lista os dele, sem quem fechou", async () => {
      closingsMock.list.mockResolvedValue([item]);
      const result = await service.listClosings(user, { page: 1, limit: 10 });
      expect(closingsMock.list).toHaveBeenCalledWith("pro-1", "company-1");
      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({ number: 7, paidAmount: "80.00" });
      expect(result.items[0]).not.toHaveProperty("createdBy");
    });

    it("pagina os fechamentos, mantendo o total", async () => {
      closingsMock.list.mockResolvedValue(
        [5, 4, 3, 2, 1].map((number) => ({
          ...item,
          id: `f${number}`,
          number,
        })),
      );
      const second = await service.listClosings(user, { page: 2, limit: 2 });
      expect(second.items.map((closing) => closing.number)).toEqual([3, 2]);
      expect(second).toMatchObject({ total: 5, page: 2, limit: 2 });
      const last = await service.listClosings(user, { page: 3, limit: 2 });
      expect(last.items.map((closing) => closing.number)).toEqual([1]);
    });

    it("o recibo vem completo, sem os nomes de quem fechou ou desfez", async () => {
      closingsMock.receipt.mockResolvedValue({
        ...item,
        cancelledBy: { id: "u2", name: "Outro" },
        company: {
          name: "Studio",
          corporateReason: "Studio LTDA",
          document: "1",
        },
        professional: { id: "pro-1", name: "Camila", document: "123" },
        details: { commissions: [], advances: [] },
      });
      const result = await service.receipt(user, "f1");
      expect(result).toMatchObject({
        number: 7,
        company: { corporateReason: "Studio LTDA" },
        professional: { name: "Camila", document: "123" },
        details: { commissions: [], advances: [] },
      });
      expect(result).not.toHaveProperty("createdBy");
      expect(result).not.toHaveProperty("cancelledBy");
      expect(result.professional).not.toHaveProperty("id");
    });

    it("o recibo de outro profissional responde 404", async () => {
      closingsMock.receipt.mockResolvedValue({
        ...item,
        professional: { id: "pro-2", name: "Outro", document: null },
        company: { name: "S", corporateReason: "S", document: "1" },
        cancelledBy: null,
        details: { commissions: [], advances: [] },
      });
      await expect(service.receipt(user, "f1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("exige a funcionalidade comissões também nos fechamentos", async () => {
      accessMock.can.mockResolvedValue(false);
      await expect(
        service.listClosings(user, { page: 1, limit: 10 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.receipt(user, "f1")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
