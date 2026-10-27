import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminUser,
  COMPANY_ID,
} from "../../../test/fixtures/authenticated-users";
import { LocalFileStorage } from "../../common/storage/local-file-storage.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PeopleService } from "../people/people.service";
import { AnamnesisPdfService } from "./anamnesis-pdf.service";
import { AnamnesisService } from "./anamnesis.service";

const question = {
  id: "q1",
  position: 1,
  label: "Tem alergia?",
  helpText: null,
  type: "YES_NO",
  isRequired: true,
  options: [],
  detailLabel: "Qual?",
};
const view = {
  id: "anamnesis-1",
  createdAt: new Date("2026-10-20T12:00:00Z"),
  client: { id: "client-1", name: "Joana" },
  template: { id: "t1", name: "Fisioterapia" },
  version: { id: "v1", version: 1, questions: [question] },
  current: [],
  entries: [
    {
      id: "e1",
      kind: "INITIAL",
      consultationDate: new Date("2026-10-20T00:00:00Z"),
      appointmentId: null,
      evolution: null,
      authorUser: { id: "u1", name: "Admin" },
      authorProfessional: null,
      createdAt: new Date("2026-10-20T12:00:00Z"),
      answers: [
        { questionId: "q1", value: { answer: true, detail: "Dipirona" } },
      ],
    },
  ],
};

describe("AnamnesisPdfService", () => {
  let service: AnamnesisPdfService;
  const prismaMock = { company: { findUniqueOrThrow: vi.fn() } };
  const anamnesisMock = { getView: vi.fn() };
  const peopleMock = { findDetail: vi.fn() };
  const auditMock = { record: vi.fn() };
  const storageMock = { read: vi.fn() };
  // PNG de 1x1 pixel (válido) e um JPEG mínimo só pela assinatura.
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  beforeEach(async () => {
    vi.clearAllMocks();
    anamnesisMock.getView.mockResolvedValue(view);
    prismaMock.company.findUniqueOrThrow.mockResolvedValue({
      corporateReason: "Bem Estar LTDA",
      fantasyName: "Bem Estar",
      document: "11222333000181",
      timezone: "America/Sao_Paulo",
      logoUrl: null,
      contacts: [{ phone: "3133334444", email: "contato@bemestar.com" }],
      addresses: [],
    });
    peopleMock.findDetail.mockResolvedValue({
      name: "Joana Souza",
      document: "12345678909",
      birthDate: new Date("1990-05-10T00:00:00Z"),
      principalContact: { phone: "31999998888" },
      principalAddress: {
        cep: "30123456",
        street: "Rua das Flores",
        number: "100",
        complement: null,
        neighborhood: "Centro",
        city: { name: "Belo Horizonte", state: { acronym: "MG" } },
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnamnesisPdfService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AnamnesisService, useValue: anamnesisMock },
        { provide: PeopleService, useValue: peopleMock },
        { provide: AuditService, useValue: auditMock },
        { provide: LocalFileStorage, useValue: storageMock },
      ],
    }).compile();

    service = module.get(AnamnesisPdfService);
  });

  it("gera um PDF de verdade e audita a geração", async () => {
    const pdf = await service.generate(
      "anamnesis-1",
      { includeHistory: true },
      adminUser,
      "10.0.0.1",
    );

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
    expect(anamnesisMock.getView).toHaveBeenCalledWith(
      "anamnesis-1",
      adminUser,
    );
    expect(auditMock.record).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      userId: adminUser.id,
      action: "ANAMNESIS_PDF_GENERATED",
      entityType: "ANAMNESIS",
      entityId: "anamnesis-1",
      clientId: "client-1",
      ip: "10.0.0.1",
    });
  });

  it("usa o cliente da própria empresa e a empresa do usuário", async () => {
    await service.generate("anamnesis-1", { includeHistory: false }, adminUser);

    expect(peopleMock.findDetail).toHaveBeenCalledWith("client-1", COMPANY_ID);
    expect(prismaMock.company.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: COMPANY_ID } }),
    );
  });

  it("sem acesso ou com ficha de outra empresa, nada é gerado nem auditado", async () => {
    anamnesisMock.getView.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.generate("x", { includeHistory: true }, adminUser),
    ).rejects.toBeInstanceOf(ForbiddenException);

    anamnesisMock.getView.mockRejectedValueOnce(new NotFoundException());
    await expect(
      service.generate("x", { includeHistory: true }, adminUser),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(auditMock.record).not.toHaveBeenCalled();
  });

  it("não entrega o PDF se a auditoria falhar", async () => {
    auditMock.record.mockRejectedValueOnce(new Error("db fora"));

    await expect(
      service.generate("anamnesis-1", { includeHistory: true }, adminUser),
    ).rejects.toThrow("db fora");
  });

  describe("logomarca", () => {
    const withLogo = (logoUrl: string | null) =>
      prismaMock.company.findUniqueOrThrow.mockResolvedValue({
        corporateReason: "Bem Estar LTDA",
        fantasyName: "Bem Estar",
        document: "11222333000181",
        timezone: "America/Sao_Paulo",
        logoUrl,
        contacts: [],
        addresses: [],
      });
    const generate = () =>
      service.generate("anamnesis-1", { includeHistory: false }, adminUser);
    // Uma imagem de verdade é um objeto "/Subtype /Image" (o "/ImageB /ImageC" do
    // ProcSet aparece em todo PDF do pdfkit, com ou sem imagem).
    const hasImage = (pdf: Buffer) =>
      /\/Subtype\s*\/Image\b/.test(pdf.toString("latin1"));

    it("imprime a logo PNG da pasta de logos da empresa", async () => {
      withLogo("/uploads/companies/logo.png");
      storageMock.read.mockResolvedValue(PNG);

      const pdf = await generate();

      expect(storageMock.read).toHaveBeenCalledWith(
        "/uploads/companies/logo.png",
      );
      expect(hasImage(pdf)).toBe(true);
    });

    it("sem logo, gera o PDF sem imagem", async () => {
      withLogo(null);

      const pdf = await generate();

      expect(storageMock.read).not.toHaveBeenCalled();
      expect(hasImage(pdf)).toBe(false);
    });

    it.each([
      ["URL externa", "https://exemplo.com/logo.png"],
      ["foto de pessoa", "/uploads/people/foto.png"],
      ["fora da pasta", "/uploads/companies/../people/foto.png"],
    ])("ignora logo que é %s, sem ler arquivo nem falhar", async (_, url) => {
      // O último caso passa pelo prefixo, mas o armazenamento recusa o caminho (null).
      withLogo(url);
      storageMock.read.mockResolvedValue(null);

      const pdf = await generate();

      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(hasImage(pdf)).toBe(false);
    });

    it("ignora arquivo que não é PNG nem JPEG (ex.: SVG ou GIF), sem falhar", async () => {
      withLogo("/uploads/companies/logo.png");
      storageMock.read.mockResolvedValue(Buffer.from("<svg></svg>"));

      const pdf = await generate();

      expect(hasImage(pdf)).toBe(false);
    });

    it("ignora arquivo ausente", async () => {
      withLogo("/uploads/companies/sumiu.png");
      storageMock.read.mockResolvedValue(null);

      expect(hasImage(await generate())).toBe(false);
    });
  });
});
