import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminUser,
  COMPANY_ID,
  regularUser,
} from "../../../test/fixtures/authenticated-users";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AnamnesisAccessService } from "./anamnesis-access.service";
import { AnamnesisTemplateService } from "./anamnesis-template.service";
import { CreateAnamnesisTemplateDto } from "./dto/create-anamnesis-template.dto";

const anyDate: unknown = expect.any(Date);

describe("AnamnesisTemplateService", () => {
  let service: AnamnesisTemplateService;
  const prismaMock = {
    $transaction: vi.fn(
      (operations: Promise<unknown>[] | ((tx: unknown) => unknown)) =>
        typeof operations === "function"
          ? operations(prismaMock)
          : Promise.all(operations),
    ),
    anamnesisTemplate: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
  const accessMock = { ensureAccess: vi.fn() };
  const auditMock = { record: vi.fn() };

  const dto: CreateAnamnesisTemplateDto = {
    name: "Fisioterapia",
    questions: [
      { label: "Tem alergia?", type: "YES_NO", detailLabel: "Qual?" },
      {
        label: "Dor",
        type: "SINGLE_CHOICE",
        options: ["Leve", "Forte"],
        isRequired: true,
      },
    ],
  };
  const stored = {
    id: "template-1",
    companyId: COMPANY_ID,
    name: "Fisioterapia",
    description: null,
    isActive: true,
    versions: [{ id: "version-1", version: 1, questions: [] }],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // clearAllMocks não desfaz implementações: cada teste começa com acesso liberado.
    accessMock.ensureAccess.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnamnesisTemplateService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AnamnesisAccessService, useValue: accessMock },
        { provide: AuditService, useValue: auditMock },
      ],
    }).compile();

    service = module.get(AnamnesisTemplateService);
  });

  describe("create", () => {
    it("cria o modelo com a versão 1, posições pela ordem e audita na transação", async () => {
      prismaMock.anamnesisTemplate.create.mockResolvedValue(stored);

      const result = await service.create(dto, adminUser, "10.0.0.1");

      const args = prismaMock.anamnesisTemplate.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(args.data).toEqual({
        name: "Fisioterapia",
        normalizedName: "fisioterapia",
        companyId: COMPANY_ID,
        versions: {
          create: {
            version: 1,
            createdById: adminUser.id,
            questions: {
              create: [
                {
                  position: 1,
                  label: "Tem alergia?",
                  helpText: undefined,
                  type: "YES_NO",
                  isRequired: false,
                  options: [],
                  detailLabel: "Qual?",
                },
                {
                  position: 2,
                  label: "Dor",
                  helpText: undefined,
                  type: "SINGLE_CHOICE",
                  isRequired: true,
                  options: ["Leve", "Forte"],
                  detailLabel: undefined,
                },
              ],
            },
          },
        },
      });
      expect(auditMock.record).toHaveBeenCalledWith(
        {
          companyId: COMPANY_ID,
          userId: adminUser.id,
          action: "ANAMNESIS_TEMPLATE_CREATED",
          entityType: "ANAMNESIS_TEMPLATE",
          entityId: "template-1",
          ip: "10.0.0.1",
        },
        prismaMock,
      );
      expect(result.currentVersion).toEqual(stored.versions[0]);
      expect(result).not.toHaveProperty("versions");
    });

    it("recusa perguntas inválidas para o tipo (400) sem gravar", async () => {
      await expect(
        service.create(
          { ...dto, questions: [{ label: "Dor", type: "SINGLE_CHOICE" }] },
          adminUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.anamnesisTemplate.create).not.toHaveBeenCalled();
    });

    it("converte nome duplicado em 409", async () => {
      prismaMock.anamnesisTemplate.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("duplicado", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(service.create(dto, adminUser)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe("consulta", () => {
    it("lista só a empresa do usuário, com busca sem acento, após conferir o acesso", async () => {
      prismaMock.anamnesisTemplate.findMany.mockResolvedValue([stored]);
      prismaMock.anamnesisTemplate.count.mockResolvedValue(1);

      const result = await service.findAll(
        { page: 1, limit: 10, name: "FISIO", isActive: true },
        regularUser,
      );

      expect(accessMock.ensureAccess).toHaveBeenCalledWith(regularUser);
      expect(prismaMock.anamnesisTemplate.count).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY_ID,
          isActive: true,
          normalizedName: { contains: "fisio" },
        },
      });
      expect(result.items[0].currentVersion).toEqual(stored.versions[0]);
    });

    it("não consulta sem acesso (403)", async () => {
      accessMock.ensureAccess.mockRejectedValue(new ForbiddenException());

      await expect(
        service.findAll({ page: 1, limit: 10 }, regularUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.findOne("template-1", regularUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.anamnesisTemplate.findMany).not.toHaveBeenCalled();
    });

    it("modelo de outra empresa ou inexistente é 404", async () => {
      prismaMock.anamnesisTemplate.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne("template-9", adminUser),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.anamnesisTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "template-9", companyId: COMPANY_ID },
        }),
      );
    });
  });

  describe("update", () => {
    beforeEach(() => {
      prismaMock.anamnesisTemplate.findFirst.mockResolvedValue({
        ...stored,
        versions: [{ id: "version-3", version: 3, questions: [] }],
      });
      prismaMock.anamnesisTemplate.update.mockResolvedValue(stored);
    });

    it("com perguntas, cria a versão seguinte (vigente + 1) e audita", async () => {
      await service.update(
        "template-1",
        { questions: dto.questions },
        adminUser,
        "10.0.0.1",
      );

      const args = prismaMock.anamnesisTemplate.update.mock.calls[0][0] as {
        data: {
          versions: { create: { version: number; createdById: string } };
        };
      };
      expect(args.data.versions.create).toMatchObject({
        version: 4,
        createdById: adminUser.id,
      });
      expect(auditMock.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ANAMNESIS_TEMPLATE_UPDATED",
          entityId: "template-1",
        }),
        prismaMock,
      );
    });

    it("renomear e inativar não criam versão e mantêm a busca em sincronia", async () => {
      prismaMock.anamnesisTemplate.findFirst
        .mockResolvedValueOnce(stored)
        .mockResolvedValueOnce(null);

      await service.update(
        "template-1",
        { name: "Pilates Clínico", isActive: false },
        adminUser,
      );

      expect(prismaMock.anamnesisTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "template-1" },
          data: {
            name: "Pilates Clínico",
            isActive: false,
            normalizedName: "pilates clinico",
            updatedAt: anyDate,
          },
        }),
      );
    });

    it("recusa renomear para o nome de outro modelo (409)", async () => {
      prismaMock.anamnesisTemplate.findFirst
        .mockResolvedValueOnce(stored)
        .mockResolvedValueOnce({ id: "template-2" });

      await expect(
        service.update("template-1", { name: "Pilates" }, adminUser),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.anamnesisTemplate.update).not.toHaveBeenCalled();
    });

    it("converte a edição simultânea em 409", async () => {
      prismaMock.anamnesisTemplate.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("duplicado", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(
        service.update("template-1", { questions: dto.questions }, adminUser),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("recusa perguntas inválidas (400) e modelo inexistente (404)", async () => {
      await expect(
        service.update(
          "template-1",
          { questions: [{ label: "x", type: "NUMBER", options: ["1"] }] },
          adminUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      prismaMock.anamnesisTemplate.findFirst.mockResolvedValue(null);
      await expect(
        service.update("template-9", {}, adminUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
