import {
  BadRequestException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../prisma/prisma.service";
import { PeopleService } from "../people/people.service";
import { MessageSenderService } from "./message-sender.service";
import { PortalCompanyService } from "./portal-company.service";
import { hashCode, hashSessionToken } from "./portal-code";
import { PortalAuthService } from "./portal-auth.service";

const SECRET = "segredo-de-teste";
const COMPANY = {
  id: "company-1",
  fantasyName: "Studio Aurora",
  corporateReason: "Aurora LTDA",
  isActive: true,
};
const PHONE = "31988887777";
const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 1_000);

describe("PortalAuthService", () => {
  let service: PortalAuthService;
  const prismaMock = {
    company: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    people: { findMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    portalVerification: {
      create: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    portalSession: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  };
  const peopleMock = { create: vi.fn() };
  const senderMock = { sendVerificationCode: vi.fn() };
  const portalCompanyMock = { findBySlug: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    portalCompanyMock.findBySlug.mockResolvedValue({
      id: COMPANY.id,
      name: "Studio Aurora",
    });
    prismaMock.portalVerification.count.mockResolvedValue(0);
    prismaMock.portalVerification.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.people.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortalAuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: { get: () => SECRET } },
        { provide: PeopleService, useValue: peopleMock },
        { provide: MessageSenderService, useValue: senderMock },
        { provide: PortalCompanyService, useValue: portalCompanyMock },
      ],
    }).compile();
    service = module.get(PortalAuthService);
  });

  describe("requestCode", () => {
    it("grava só o hash do código e envia o código com o nome da clínica", async () => {
      await service.requestCode("aurora", "(31) 98888-7777", "1.2.3.4");

      const { data } = prismaMock.portalVerification.create.mock
        .calls[0][0] as {
        data: { phone: string; codeHash: string; companyId: string };
      };
      const sent = senderMock.sendVerificationCode.mock.calls[0][0] as {
        code: string;
        companyName: string;
        phone: string;
      };
      expect(data.phone).toBe(PHONE);
      expect(data.codeHash).toBe(
        hashCode(SECRET, COMPANY.id, PHONE, sent.code),
      );
      expect(data.codeHash).not.toContain(sent.code);
      expect(sent).toMatchObject({
        companyName: "Studio Aurora",
        phone: PHONE,
      });
    });

    it("telefone inválido: 400, sem gravar nem enviar", async () => {
      await expect(service.requestCode("aurora", "123")).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prismaMock.portalVerification.create).not.toHaveBeenCalled();
      expect(senderMock.sendVerificationCode).not.toHaveBeenCalled();
    });

    it("pedidos demais para o telefone: 429", async () => {
      prismaMock.portalVerification.count.mockResolvedValueOnce(3);
      const error = await service
        .requestCode("aurora", PHONE)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect(senderMock.sendVerificationCode).not.toHaveBeenCalled();
    });
  });

  describe("verifyCode", () => {
    const pending = (overrides: object = {}) => ({
      id: "v-1",
      codeHash: hashCode(SECRET, COMPANY.id, PHONE, "123456"),
      attempts: 0,
      expiresAt: future(),
      ...overrides,
    });

    it("código certo: marca como conferido e lista as pessoas do telefone", async () => {
      prismaMock.portalVerification.findFirst.mockResolvedValue(pending());
      prismaMock.people.findMany.mockResolvedValue([
        { id: "p-1", name: "Ana" },
      ]);

      await expect(
        service.verifyCode("aurora", PHONE, "123456"),
      ).resolves.toEqual({
        verificationId: "v-1",
        people: [{ id: "p-1", name: "Ana" }],
      });
      expect(prismaMock.portalVerification.update).toHaveBeenCalledWith({
        where: { id: "v-1" },
        data: { verifiedAt: expect.any(Date) as Date },
      });
    });

    it("procura só clientes ativos da clínica com o telefone num contato ativo", async () => {
      prismaMock.portalVerification.findFirst.mockResolvedValue(pending());
      await service.verifyCode("aurora", PHONE, "123456");
      expect(prismaMock.people.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId: COMPANY.id,
            type: "CLIENT",
            deletedAt: null,
            contacts: { some: { phone: PHONE, deletedAt: null } },
          },
        }),
      );
    });

    it("código errado: conta a tentativa e recusa", async () => {
      prismaMock.portalVerification.findFirst.mockResolvedValue(pending());
      await expect(
        service.verifyCode("aurora", PHONE, "000000"),
      ).rejects.toThrow("Código incorreto");
      expect(prismaMock.portalVerification.update).toHaveBeenCalledWith({
        where: { id: "v-1" },
        data: { attempts: { increment: 1 } },
      });
    });

    it.each([
      ["vencido", { expiresAt: past() }],
      ["sem tentativas", { attempts: 5 }],
    ])("código %s: recusa sem conferir", async (_, overrides) => {
      prismaMock.portalVerification.findFirst.mockResolvedValue(
        pending(overrides),
      );
      await expect(
        service.verifyCode("aurora", PHONE, "123456"),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.portalVerification.update).not.toHaveBeenCalled();
    });

    it("sem pedido pendente: recusa", async () => {
      prismaMock.portalVerification.findFirst.mockResolvedValue(null);
      await expect(
        service.verifyCode("aurora", PHONE, "123456"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("createSession", () => {
    const verified = (overrides: object = {}) => ({
      id: "v-1",
      phone: PHONE,
      verifiedAt: new Date(),
      usedAt: null,
      ...overrides,
    });

    it("com uma das pessoas do telefone: abre a sessão e guarda só o hash do token", async () => {
      prismaMock.portalVerification.findFirst.mockResolvedValue(verified());
      prismaMock.people.findMany.mockResolvedValue([
        { id: "p-1", name: "Ana" },
      ]);

      const result = await service.createSession("aurora", {
        verificationId: "v-1",
        personId: "p-1",
      });

      const { data } = prismaMock.portalSession.create.mock.calls[0][0] as {
        data: { tokenHash: string; peopleId: string; companyId: string };
      };
      expect(result.person).toEqual({ id: "p-1", name: "Ana" });
      expect(data).toMatchObject({ peopleId: "p-1", companyId: COMPANY.id });
      expect(data.tokenHash).toBe(hashSessionToken(result.token));
    });

    it("pessoa que não é do telefone conferido: recusa (ninguém entra como outro)", async () => {
      prismaMock.portalVerification.findFirst.mockResolvedValue(verified());
      prismaMock.people.findMany.mockResolvedValue([
        { id: "p-1", name: "Ana" },
      ]);

      await expect(
        service.createSession("aurora", {
          verificationId: "v-1",
          personId: "p-9",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.portalSession.create).not.toHaveBeenCalled();
    });

    it("com o nome: cria o cliente com nome e telefone", async () => {
      prismaMock.portalVerification.findFirst.mockResolvedValue(verified());
      peopleMock.create.mockResolvedValue({ id: "p-novo", name: "Bia" });

      await service.createSession("aurora", {
        verificationId: "v-1",
        name: "Bia",
      });

      expect(peopleMock.create).toHaveBeenCalledWith(
        { name: "Bia", type: "CLIENT", phone: PHONE },
        COMPANY.id,
      );
    });

    it.each([
      ["não conferida", { verifiedAt: null }],
      ["já usada", { usedAt: new Date() }],
      [
        "conferida há mais de 10 minutos",
        { verifiedAt: new Date(Date.now() - 11 * 60_000) },
      ],
    ])("verificação %s: recusa", async (_, overrides) => {
      prismaMock.portalVerification.findFirst.mockResolvedValue(
        verified(overrides),
      );
      await expect(
        service.createSession("aurora", { verificationId: "v-1", name: "Bia" }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.portalSession.create).not.toHaveBeenCalled();
    });

    it("duas chamadas ao mesmo tempo: só uma abre a sessão", async () => {
      prismaMock.portalVerification.findFirst.mockResolvedValue(verified());
      prismaMock.people.findMany.mockResolvedValue([
        { id: "p-1", name: "Ana" },
      ]);
      prismaMock.portalVerification.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.createSession("aurora", {
          verificationId: "v-1",
          personId: "p-1",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.portalSession.create).not.toHaveBeenCalled();
    });
  });

  describe("authenticate", () => {
    const session = (overrides: object = {}) => ({
      id: "s-1",
      companyId: COMPANY.id,
      peopleId: "p-1",
      revokedAt: null,
      expiresAt: future(),
      people: { deletedAt: null },
      ...overrides,
    });

    it("sessão válida: devolve o cliente", async () => {
      prismaMock.portalSession.findUnique.mockResolvedValue(session());
      await expect(service.authenticate("aurora", "token")).resolves.toEqual({
        sessionId: "s-1",
        companyId: COMPANY.id,
        peopleId: "p-1",
      });
      expect(prismaMock.portalSession.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: hashSessionToken("token") },
        }),
      );
    });

    it.each([
      ["inexistente", null],
      ["revogada", { revokedAt: new Date() }],
      ["vencida", { expiresAt: past() }],
      ["de outra clínica", { companyId: "company-2" }],
      ["de cliente inativo", { people: { deletedAt: new Date() } }],
    ])("sessão %s: 401", async (_, overrides) => {
      prismaMock.portalSession.findUnique.mockResolvedValue(
        overrides === null ? null : session(overrides),
      );
      await expect(
        service.authenticate("aurora", "token"),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it("portal desligado, fora do plano ou clínica inativa: 401 sem consultar a sessão", async () => {
    portalCompanyMock.findBySlug.mockRejectedValueOnce(new NotFoundException());
    await expect(
      service.authenticate("aurora", "token"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prismaMock.portalSession.findUnique).not.toHaveBeenCalled();
  });

  it("logout revoga só a sessão deste aparelho", async () => {
    await service.logout({
      sessionId: "s-1",
      companyId: COMPANY.id,
      peopleId: "p-1",
    });
    expect(prismaMock.portalSession.update).toHaveBeenCalledWith({
      where: { id: "s-1" },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });
});
