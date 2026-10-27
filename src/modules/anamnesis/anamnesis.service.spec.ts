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
import { AppointmentService } from "../appointment/appointment.service";
import { CompanyService } from "../company/company.service";
import { PeopleService } from "../people/people.service";
import { AnamnesisAccessService } from "./anamnesis-access.service";
import { AnamnesisCryptoService } from "./anamnesis-crypto.service";
import { AnamnesisService } from "./anamnesis.service";

const containing = (expected: object): unknown =>
  expect.objectContaining(expected);

describe("AnamnesisService", () => {
  let service: AnamnesisService;
  const prismaMock = {
    $transaction: vi.fn(
      (operations: Promise<unknown>[] | ((tx: unknown) => unknown)) =>
        typeof operations === "function"
          ? operations(prismaMock)
          : Promise.all(operations),
    ),
    anamnesis: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    anamnesisEntry: { create: vi.fn(), findMany: vi.fn() },
    anamnesisTemplate: { findFirst: vi.fn() },
    people: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  };
  const accessMock = { ensureAccess: vi.fn(), findProfessionalId: vi.fn() };
  const auditMock = { record: vi.fn() };
  const peopleMock = { findOne: vi.fn() };
  const companyMock = { getTimeZone: vi.fn() };
  const appointmentMock = { findOne: vi.fn() };
  // Criptografia reversível e visível nos testes: "enc(" + texto + ")".
  const cryptoMock = {
    encrypt: vi.fn((text: string) => `enc(${text})`),
    decrypt: vi.fn((stored: string) => stored.slice(4, -1)),
  };

  const questions = [
    {
      id: "q1",
      position: 1,
      label: "Alergia",
      helpText: null,
      type: "YES_NO",
      isRequired: true,
      options: [],
      detailLabel: "Qual?",
    },
    {
      id: "q2",
      position: 2,
      label: "Dor",
      helpText: null,
      type: "SCALE",
      isRequired: false,
      options: [],
      detailLabel: null,
    },
  ];
  const template = {
    id: "template-1",
    isActive: true,
    versions: [{ id: "version-2", questions }],
  };
  const dto = {
    clientId: "client-1",
    templateId: "template-1",
    consultationDate: "2026-10-20",
    answers: [
      { questionId: "q1", value: { answer: true, detail: "Dipirona" } },
    ],
  };
  const storedView = {
    id: "anamnesis-1",
    createdAt: new Date("2026-10-27T12:00:00Z"),
    client: { id: "client-1", name: "Cliente" },
    template: { id: "template-1", name: "Fisioterapia" },
    version: { id: "version-2", version: 2, questions },
    entries: [
      {
        id: "entry-1",
        kind: "INITIAL",
        consultationDate: new Date("2026-10-20T00:00:00Z"),
        appointmentId: null,
        evolution: null,
        authorUser: { id: adminUser.id, name: "Admin" },
        authorProfessional: null,
        createdAt: new Date("2026-10-27T12:00:00Z"),
        answers: [
          {
            questionId: "q1",
            value: 'enc({"answer":true,"detail":"Dipirona"})',
          },
          { questionId: "q2", value: "enc(3)" },
        ],
      },
      {
        id: "entry-2",
        kind: "FOLLOW_UP",
        consultationDate: new Date("2026-10-25T00:00:00Z"),
        appointmentId: null,
        evolution: "enc(Melhorou)",
        authorUser: { id: adminUser.id, name: "Admin" },
        authorProfessional: { id: "prof-1", name: "Dra. Paula" },
        createdAt: new Date("2026-10-27T13:00:00Z"),
        answers: [{ questionId: "q2", value: "enc(1)" }],
      },
    ],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    accessMock.ensureAccess.mockResolvedValue(undefined);
    accessMock.findProfessionalId.mockResolvedValue("prof-1");
    peopleMock.findOne.mockResolvedValue({ id: "client-1", type: "CLIENT" });
    prismaMock.anamnesisTemplate.findFirst.mockResolvedValue(template);
    companyMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");
    prismaMock.anamnesis.create.mockResolvedValue({
      id: "anamnesis-1",
      entries: [{ id: "entry-1" }],
    });
    prismaMock.anamnesis.findFirst.mockResolvedValue(storedView);
    prismaMock.anamnesisEntry.create.mockResolvedValue({ id: "entry-3" });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnamnesisService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AnamnesisAccessService, useValue: accessMock },
        { provide: AnamnesisCryptoService, useValue: cryptoMock },
        { provide: AuditService, useValue: auditMock },
        { provide: PeopleService, useValue: peopleMock },
        { provide: CompanyService, useValue: companyMock },
        { provide: AppointmentService, useValue: appointmentMock },
      ],
    }).compile();

    service = module.get(AnamnesisService);
  });

  describe("create", () => {
    it("grava a ficha presa à versão vigente, com respostas cifradas, autor e auditoria", async () => {
      await service.create(dto, adminUser, "10.0.0.1");

      const args = prismaMock.anamnesis.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(args.data).toEqual({
        companyId: COMPANY_ID,
        clientId: "client-1",
        templateId: "template-1",
        versionId: "version-2",
        entries: {
          create: {
            kind: "INITIAL",
            consultationDate: new Date("2026-10-20T00:00:00.000Z"),
            authorUserId: adminUser.id,
            authorProfessionalId: "prof-1",
            answers: {
              create: [
                {
                  question: { connect: { id: "q1" } },
                  value: 'enc({"answer":true,"detail":"Dipirona"})',
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
          action: "ANAMNESIS_ENTRY_CREATED",
          entityType: "ANAMNESIS_ENTRY",
          entityId: "entry-1",
          clientId: "client-1",
          ip: "10.0.0.1",
        },
        prismaMock,
      );
    });

    it("sem data informada, usa hoje no fuso da empresa", async () => {
      vi.useFakeTimers();
      // 02:00 UTC de 28/10 ainda é 27/10 em São Paulo.
      vi.setSystemTime(new Date("2026-10-28T02:00:00Z"));
      try {
        await service.create(
          { ...dto, consultationDate: undefined },
          adminUser,
        );
      } finally {
        vi.useRealTimers();
      }

      const args = prismaMock.anamnesis.create.mock.calls[0][0] as {
        data: { entries: { create: { consultationDate: Date } } };
      };
      expect(args.data.entries.create.consultationDate).toEqual(
        new Date("2026-10-27T00:00:00.000Z"),
      );
    });

    it("recusa data futura ou inexistente (400), sem gravar", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-27T15:00:00Z"));
      try {
        await expect(
          service.create({ ...dto, consultationDate: "2026-10-28" }, adminUser),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          service.create({ ...dto, consultationDate: "2026-02-30" }, adminUser),
        ).rejects.toBeInstanceOf(BadRequestException);
        // Hoje é permitido.
        await service.create(
          { ...dto, consultationDate: "2026-10-27" },
          adminUser,
        );
      } finally {
        vi.useRealTimers();
      }
      expect(prismaMock.anamnesis.create).toHaveBeenCalledTimes(1);
    });

    it("sem acesso (403), nada é consultado nem gravado", async () => {
      accessMock.ensureAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.create(dto, regularUser)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(peopleMock.findOne).not.toHaveBeenCalled();
      expect(prismaMock.anamnesis.create).not.toHaveBeenCalled();
    });

    it("recusa pessoa que não é cliente (400)", async () => {
      peopleMock.findOne.mockResolvedValue({
        id: "client-1",
        type: "PROFESSIONAL",
      });

      await expect(service.create(dto, adminUser)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("modelo de outra empresa é 404 e modelo inativo é 409", async () => {
      prismaMock.anamnesisTemplate.findFirst.mockResolvedValueOnce(null);
      await expect(service.create(dto, adminUser)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prismaMock.anamnesisTemplate.findFirst).toHaveBeenCalledWith(
        containing({ where: { id: "template-1", companyId: COMPANY_ID } }),
      );

      prismaMock.anamnesisTemplate.findFirst.mockResolvedValueOnce({
        ...template,
        isActive: false,
      });
      await expect(service.create(dto, adminUser)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("recusa obrigatória sem resposta e resposta inválida (400)", async () => {
      await expect(
        service.create({ ...dto, answers: [] }, adminUser),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(
          { ...dto, answers: [{ questionId: "q1", value: "sim" }] },
          adminUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.anamnesis.create).not.toHaveBeenCalled();
    });

    it("segunda ficha do mesmo cliente e modelo é 409", async () => {
      prismaMock.anamnesis.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("duplicado", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(service.create(dto, adminUser)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("devolve a ficha decifrada", async () => {
      const view = await service.create(dto, adminUser);

      expect(view.id).toBe("anamnesis-1");
      expect(view.entries[0].answers[0].value).toEqual({
        answer: true,
        detail: "Dipirona",
      });
    });
  });

  describe("findOne", () => {
    it("decifra, monta a situação atual pela resposta mais recente e audita a leitura", async () => {
      const view = await service.findOne("anamnesis-1", adminUser, "10.0.0.1");

      expect(view.entries.map((entry) => entry.evolution)).toEqual([
        null,
        "Melhorou",
      ]);
      // q1 só no registro inicial; q2 foi atualizada no acompanhamento.
      expect(view.current).toEqual([
        {
          questionId: "q1",
          value: { answer: true, detail: "Dipirona" },
          entryId: "entry-1",
          consultationDate: new Date("2026-10-20T00:00:00Z"),
        },
        {
          questionId: "q2",
          value: 1,
          entryId: "entry-2",
          consultationDate: new Date("2026-10-25T00:00:00Z"),
        },
      ]);
      expect(auditMock.record).toHaveBeenCalledWith({
        companyId: COMPANY_ID,
        userId: adminUser.id,
        action: "ANAMNESIS_VIEWED",
        entityType: "ANAMNESIS",
        entityId: "anamnesis-1",
        clientId: "client-1",
        ip: "10.0.0.1",
      });
    });

    it("ficha de outra empresa é 404 e não audita", async () => {
      prismaMock.anamnesis.findFirst.mockResolvedValue(null);

      await expect(service.findOne("x", adminUser)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prismaMock.anamnesis.findFirst).toHaveBeenCalledWith(
        containing({ where: { id: "x", companyId: COMPANY_ID } }),
      );
      expect(auditMock.record).not.toHaveBeenCalled();
    });

    it("sem acesso (403), nada é lido", async () => {
      accessMock.ensureAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.findOne("x", regularUser)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prismaMock.anamnesis.findFirst).not.toHaveBeenCalled();
    });

    it("não entrega os dados se a auditoria falhar", async () => {
      auditMock.record.mockRejectedValueOnce(new Error("db fora"));

      await expect(service.findOne("anamnesis-1", adminUser)).rejects.toThrow(
        "db fora",
      );
    });
  });

  describe("findByClient", () => {
    it("lista o resumo das fichas do cliente e audita a listagem", async () => {
      prismaMock.people.findFirst.mockResolvedValue({ id: "client-1" });
      prismaMock.anamnesis.findMany.mockResolvedValue([
        {
          id: "anamnesis-1",
          createdAt: new Date("2026-10-27T12:00:00Z"),
          template: { id: "template-1", name: "Fisioterapia" },
          version: { version: 2 },
          _count: { entries: 2 },
          entries: [{ consultationDate: new Date("2026-10-25T00:00:00Z") }],
        },
      ]);
      prismaMock.anamnesis.count.mockResolvedValue(1);

      const result = await service.findByClient(
        { page: 1, limit: 10, clientId: "client-1" },
        adminUser,
        "10.0.0.1",
      );

      expect(prismaMock.people.findFirst).toHaveBeenCalledWith(
        containing({
          where: { id: "client-1", companyId: COMPANY_ID, type: "CLIENT" },
        }),
      );
      expect(result.items).toEqual([
        {
          id: "anamnesis-1",
          createdAt: new Date("2026-10-27T12:00:00Z"),
          template: { id: "template-1", name: "Fisioterapia" },
          templateVersion: 2,
          entriesCount: 2,
          lastConsultationDate: new Date("2026-10-25T00:00:00Z"),
        },
      ]);
      expect(auditMock.record).toHaveBeenCalledWith({
        companyId: COMPANY_ID,
        userId: adminUser.id,
        action: "ANAMNESIS_LISTED",
        entityType: "CLIENT",
        entityId: "client-1",
        clientId: "client-1",
        ip: "10.0.0.1",
      });
    });

    it("cliente de outra empresa é 404", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);

      await expect(
        service.findByClient(
          { page: 1, limit: 10, clientId: "client-9" },
          adminUser,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(auditMock.record).not.toHaveBeenCalled();
    });
  });

  describe("findClients", () => {
    it("lista os clientes com ficha e a quantidade, com uma auditoria só", async () => {
      prismaMock.people.findMany.mockResolvedValue([
        {
          id: "client-1",
          name: "Joana",
          deletedAt: null,
          _count: { anamnesesAsClient: 2 },
        },
        {
          id: "client-2",
          name: "Marcos",
          deletedAt: new Date("2026-10-01T00:00:00Z"),
          _count: { anamnesesAsClient: 1 },
        },
      ]);
      prismaMock.people.count.mockResolvedValue(2);

      const result = await service.findClients(
        { page: 1, limit: 10, name: "João" },
        adminUser,
        "10.0.0.1",
      );

      expect(result).toEqual({
        items: [
          {
            clientId: "client-1",
            clientName: "Joana",
            isActive: true,
            anamnesisCount: 2,
          },
          {
            clientId: "client-2",
            clientName: "Marcos",
            isActive: false,
            anamnesisCount: 1,
          },
        ],
        total: 2,
        page: 1,
        limit: 10,
      });
      expect(prismaMock.people.findMany).toHaveBeenCalledWith(
        containing({
          where: {
            companyId: COMPANY_ID,
            type: "CLIENT",
            anamnesesAsClient: { some: {} },
            // Busca sem acento nem maiúscula.
            normalizedName: { contains: "joao" },
          },
          orderBy: { name: "asc" },
        }),
      );
      // Uma auditoria para a página inteira, sem cliente específico.
      expect(auditMock.record).toHaveBeenCalledTimes(1);
      expect(auditMock.record).toHaveBeenCalledWith({
        companyId: COMPANY_ID,
        userId: adminUser.id,
        action: "ANAMNESIS_LISTED",
        entityType: "COMPANY",
        entityId: COMPANY_ID,
        ip: "10.0.0.1",
      });
    });

    it("sem acesso à anamnese é 403 e nem consulta", async () => {
      accessMock.ensureAccess.mockRejectedValue(new ForbiddenException());

      await expect(
        service.findClients({ page: 1, limit: 10 }, regularUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.people.findMany).not.toHaveBeenCalled();
      expect(auditMock.record).not.toHaveBeenCalled();
    });
  });

  describe("findAppointmentsWithEntry", () => {
    it("devolve só os agendamentos que têm acompanhamento, da empresa", async () => {
      prismaMock.anamnesisEntry.findMany.mockResolvedValue([
        { appointmentId: "appointment-1" },
      ]);

      const result = await service.findAppointmentsWithEntry(
        { appointmentIds: ["appointment-1", "appointment-2"] },
        adminUser,
      );

      expect(result).toEqual({ appointmentIds: ["appointment-1"] });
      expect(prismaMock.anamnesisEntry.findMany).toHaveBeenCalledWith(
        containing({
          where: {
            appointmentId: { in: ["appointment-1", "appointment-2"] },
            anamnesis: { companyId: COMPANY_ID },
          },
        }),
      );
      // Só ids de agendamento: não é leitura de ficha, então não audita.
      expect(auditMock.record).not.toHaveBeenCalled();
    });

    it("sem acesso à anamnese é 403 e nem consulta", async () => {
      accessMock.ensureAccess.mockRejectedValue(new ForbiddenException());

      await expect(
        service.findAppointmentsWithEntry(
          { appointmentIds: ["appointment-1"] },
          regularUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.anamnesisEntry.findMany).not.toHaveBeenCalled();
    });
  });

  describe("addEntry", () => {
    // Ficha como o addEntry a consulta: cliente ativo, perguntas e registro inicial em 20/10.
    const fichaForEntry = {
      clientId: "client-1",
      client: { deletedAt: null },
      version: { questions },
      entries: [{ consultationDate: new Date("2026-10-20T00:00:00Z") }],
    };
    const entryDto = {
      evolution: "Melhorou",
      consultationDate: "2026-10-25",
      answers: [{ questionId: "q2", value: 1 }],
    };

    beforeEach(() => {
      prismaMock.anamnesis.findFirst
        .mockReset()
        .mockResolvedValueOnce(fichaForEntry)
        .mockResolvedValue(storedView);
    });

    it("grava o acompanhamento com evolução e respostas cifradas, autor e auditoria", async () => {
      await service.addEntry("anamnesis-1", entryDto, adminUser, "10.0.0.1");

      expect(prismaMock.anamnesisEntry.create).toHaveBeenCalledWith({
        data: {
          anamnesisId: "anamnesis-1",
          kind: "FOLLOW_UP",
          consultationDate: new Date("2026-10-25T00:00:00.000Z"),
          appointmentId: undefined,
          evolution: "enc(Melhorou)",
          authorUserId: adminUser.id,
          authorProfessionalId: "prof-1",
          answers: {
            create: [{ question: { connect: { id: "q2" } }, value: "enc(1)" }],
          },
        },
        select: { id: true },
      });
      expect(auditMock.record).toHaveBeenCalledWith(
        {
          companyId: COMPANY_ID,
          userId: adminUser.id,
          action: "ANAMNESIS_ENTRY_CREATED",
          entityType: "ANAMNESIS_ENTRY",
          entityId: "entry-3",
          clientId: "client-1",
          ip: "10.0.0.1",
        },
        prismaMock,
      );
    });

    it("aceita acompanhamento sem respostas (só a evolução)", async () => {
      await service.addEntry(
        "anamnesis-1",
        { evolution: "Sem mudanças", consultationDate: "2026-10-25" },
        adminUser,
      );

      expect(prismaMock.anamnesisEntry.create).toHaveBeenCalledWith(
        containing({
          data: containing({ answers: { create: [] } }),
        }),
      );
    });

    it("ficha de outra empresa é 404", async () => {
      prismaMock.anamnesis.findFirst.mockReset().mockResolvedValue(null);

      await expect(
        service.addEntry("x", entryDto, adminUser),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.anamnesisEntry.create).not.toHaveBeenCalled();
    });

    it("cliente inativo não recebe novos registros (409)", async () => {
      prismaMock.anamnesis.findFirst.mockReset().mockResolvedValue({
        ...fichaForEntry,
        client: { deletedAt: new Date() },
      });

      await expect(
        service.addEntry("anamnesis-1", entryDto, adminUser),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.anamnesisEntry.create).not.toHaveBeenCalled();
    });

    it("recusa data anterior ao registro inicial e data futura (400)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-27T15:00:00Z"));
      try {
        for (const consultationDate of ["2026-10-19", "2026-10-28"]) {
          prismaMock.anamnesis.findFirst
            .mockReset()
            .mockResolvedValue(fichaForEntry);
          await expect(
            service.addEntry(
              "anamnesis-1",
              { ...entryDto, consultationDate },
              adminUser,
            ),
          ).rejects.toBeInstanceOf(BadRequestException);
        }
        // O mesmo dia do registro inicial é permitido.
        prismaMock.anamnesis.findFirst
          .mockReset()
          .mockResolvedValueOnce(fichaForEntry)
          .mockResolvedValue(storedView);
        await service.addEntry(
          "anamnesis-1",
          { ...entryDto, consultationDate: "2026-10-20" },
          adminUser,
        );
      } finally {
        vi.useRealTimers();
      }
      expect(prismaMock.anamnesisEntry.create).toHaveBeenCalledTimes(1);
    });

    it("o agendamento precisa ser da empresa (404) e do mesmo cliente (400)", async () => {
      appointmentMock.findOne.mockRejectedValueOnce(new NotFoundException());
      await expect(
        service.addEntry(
          "anamnesis-1",
          { ...entryDto, appointmentId: "appointment-9" },
          adminUser,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      prismaMock.anamnesis.findFirst
        .mockReset()
        .mockResolvedValue(fichaForEntry);
      appointmentMock.findOne.mockResolvedValueOnce({ clientId: "outro" });
      await expect(
        service.addEntry(
          "anamnesis-1",
          { ...entryDto, appointmentId: "appointment-1" },
          adminUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(appointmentMock.findOne).toHaveBeenCalledWith(
        "appointment-1",
        COMPANY_ID,
      );
      expect(prismaMock.anamnesisEntry.create).not.toHaveBeenCalled();
    });

    it("liga o agendamento do mesmo cliente", async () => {
      appointmentMock.findOne.mockResolvedValueOnce({ clientId: "client-1" });

      await service.addEntry(
        "anamnesis-1",
        { ...entryDto, appointmentId: "appointment-1" },
        adminUser,
      );

      expect(prismaMock.anamnesisEntry.create).toHaveBeenCalledWith(
        containing({
          data: containing({ appointmentId: "appointment-1" }),
        }),
      );
    });

    it("recusa resposta de pergunta que não é da ficha ou inválida (400)", async () => {
      for (const answers of [
        [{ questionId: "outra", value: 1 }],
        [{ questionId: "q2", value: 11 }],
      ]) {
        prismaMock.anamnesis.findFirst
          .mockReset()
          .mockResolvedValue(fichaForEntry);
        await expect(
          service.addEntry("anamnesis-1", { ...entryDto, answers }, adminUser),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(prismaMock.anamnesisEntry.create).not.toHaveBeenCalled();
    });

    it("sem acesso (403), nada é lido", async () => {
      accessMock.ensureAccess.mockRejectedValue(new ForbiddenException());

      await expect(
        service.addEntry("anamnesis-1", entryDto, regularUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.anamnesis.findFirst).not.toHaveBeenCalled();
    });
  });
});
