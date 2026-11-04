import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  COMPANY_ID,
  superAdminUser,
} from "../../../test/fixtures/authenticated-users";
import { FEATURE_CATALOG } from "./access-catalog";
import { CompanyAccessService } from "./company-access.service";
import type { UpdateCompanyAccessDto } from "./dto/update-company-access.dto";

describe("CompanyAccessService", () => {
  let service: CompanyAccessService;

  const tx = {
    companyFeatureAccess: { deleteMany: vi.fn(), createMany: vi.fn() },
    companyLimit: { upsert: vi.fn() },
  };
  const prismaMock = {
    company: { findUnique: vi.fn() },
    companyFeatureAccess: { findMany: vi.fn(), findUnique: vi.fn() },
    companyLimit: { findUnique: vi.fn() },
    people: { count: vi.fn() },
    user: { count: vi.fn() },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const auditMock = { record: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.company.findUnique.mockResolvedValue({ id: COMPANY_ID });
    prismaMock.companyFeatureAccess.findMany.mockResolvedValue([]);
    prismaMock.companyLimit.findUnique.mockResolvedValue(null);
    prismaMock.people.count.mockResolvedValue(2);
    prismaMock.user.count.mockResolvedValue(1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyAccessService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditService, useValue: auditMock },
      ],
    }).compile();
    service = module.get(CompanyAccessService);
  });

  const dtoWith = (
    features: UpdateCompanyAccessDto["features"],
  ): UpdateCompanyAccessDto => ({
    features,
    limits: { professionals: 3, admins: 1 },
  });
  const full = (feature: string) => ({
    feature,
    view: true,
    edit: true,
    create: true,
    remove: true,
  });

  describe("findOne", () => {
    it("traz uma entrada por funcionalidade, sem acesso onde não há linha, e o uso", async () => {
      prismaMock.companyFeatureAccess.findMany.mockResolvedValue([
        {
          feature: "clients",
          canView: true,
          canEdit: true,
          canCreate: false,
          canRemove: false,
        },
      ]);

      const result = await service.findOne(COMPANY_ID);

      expect(result.features).toHaveLength(FEATURE_CATALOG.length);
      expect(result.features.find((f) => f.feature === "clients")).toEqual({
        feature: "clients",
        view: true,
        edit: true,
        create: false,
        remove: false,
      });
      expect(result.features.find((f) => f.feature === "class-groups")).toEqual(
        {
          feature: "class-groups",
          view: false,
          edit: false,
          create: false,
          remove: false,
        },
      );
      expect(result.usage).toEqual({ professionals: 2, admins: 1 });
    });

    it("conta só os ativos (sem exclusão lógica)", async () => {
      await service.findOne(COMPANY_ID);

      expect(prismaMock.people.count).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID, type: "PROFESSIONAL", deletedAt: null },
      });
      expect(prismaMock.user.count).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID, type: "ADMIN", deletedAt: null },
      });
    });

    it("lança NotFoundException quando a empresa não existe", async () => {
      prismaMock.company.findUnique.mockResolvedValue(null);
      await expect(service.findOne("x")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("can", () => {
    it("consulta pela chave única e devolve a ação pedida", async () => {
      prismaMock.companyFeatureAccess.findUnique.mockResolvedValue({
        canView: true,
        canEdit: false,
        canCreate: true,
        canRemove: false,
      });

      await expect(service.can(COMPANY_ID, "clients", "create")).resolves.toBe(
        true,
      );
      await expect(service.can(COMPANY_ID, "clients", "edit")).resolves.toBe(
        false,
      );
      expect(prismaMock.companyFeatureAccess.findUnique).toHaveBeenCalledWith({
        where: {
          companyId_feature: { companyId: COMPANY_ID, feature: "clients" },
        },
      });
    });

    it("sem linha, sem acesso", async () => {
      prismaMock.companyFeatureAccess.findUnique.mockResolvedValue(null);
      await expect(
        service.can(COMPANY_ID, "class-groups", "view"),
      ).resolves.toBe(false);
    });
  });

  describe("findForUser", () => {
    it("ADMIN recebe os acessos da própria empresa", async () => {
      prismaMock.companyFeatureAccess.findMany.mockResolvedValue([
        {
          feature: "clients",
          canView: true,
          canEdit: false,
          canCreate: false,
          canRemove: false,
        },
      ]);

      const features = await service.findForUser("ADMIN", COMPANY_ID);

      expect(prismaMock.companyFeatureAccess.findMany).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID },
      });
      expect(features).toHaveLength(FEATURE_CATALOG.length);
      expect(features.find((f) => f.feature === "clients")?.view).toBe(true);
      expect(features.find((f) => f.feature === "class-groups")?.view).toBe(
        false,
      );
    });

    it("SUPER_ADMIN vê tudo, sem consultar o banco, respeitando as colunas de cada funcionalidade", async () => {
      const features = await service.findForUser("SUPER_ADMIN", "platform");

      expect(prismaMock.companyFeatureAccess.findMany).not.toHaveBeenCalled();
      expect(features.find((f) => f.feature === "clients")).toEqual({
        feature: "clients",
        view: true,
        edit: true,
        create: true,
        remove: true,
      });
      expect(features.find((f) => f.feature === "anamnesis-audit")).toEqual({
        feature: "anamnesis-audit",
        view: true,
        edit: false,
        create: false,
        remove: false,
      });
    });
  });

  describe("replace", () => {
    const registries = ["clients", "professionals", "services"];

    it("troca a matriz e os limites, grava só quem tem Visualiza e audita na mesma transação", async () => {
      const dto = dtoWith([
        ...registries.map(full),
        {
          feature: "class-groups",
          view: false,
          edit: false,
          create: false,
          remove: false,
        },
      ]);

      await service.replace(COMPANY_ID, dto, superAdminUser, "127.0.0.1");

      expect(tx.companyFeatureAccess.deleteMany).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID },
      });
      const [{ data }] = tx.companyFeatureAccess.createMany.mock.calls[0] as [
        { data: { feature: string }[] },
      ];
      expect(data.map((row) => row.feature)).toEqual(registries);
      expect(tx.companyLimit.upsert).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID },
        create: { companyId: COMPANY_ID, maxProfessionals: 3, maxAdmins: 1 },
        update: { maxProfessionals: 3, maxAdmins: 1 },
      });
      expect(auditMock.record).toHaveBeenCalledWith(
        {
          companyId: superAdminUser.companyId,
          userId: superAdminUser.id,
          action: "COMPANY_ACCESS_CHANGED",
          entityType: "COMPANY",
          entityId: COMPANY_ID,
          ip: "127.0.0.1",
        },
        tx,
      );
    });

    it("não grava nada quando a matriz é inválida", async () => {
      // Agendamentos sem ver clientes, profissionais e serviços.
      const dto = dtoWith([full("appointments")]);

      await expect(
        service.replace(COMPANY_ID, dto, superAdminUser),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("lança NotFoundException quando a empresa não existe", async () => {
      prismaMock.company.findUnique.mockResolvedValue(null);
      await expect(
        service.replace("x", dtoWith([]), superAdminUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
