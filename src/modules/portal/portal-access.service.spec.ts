import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import {
  adminUser,
  COMPANY_ID,
} from "../../../test/fixtures/authenticated-users";
import { hashSessionToken } from "./portal-code";
import { PortalAccessService } from "./portal-access.service";
import type { PortalAuthService } from "./portal-auth.service";
import type { PortalCompanyService } from "./portal-company.service";

describe("PortalAccessService", () => {
  const tx = {
    portalAccessLink: { updateMany: vi.fn(), create: vi.fn() },
    clientAccount: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    people: { update: vi.fn() },
    portalSession: { updateMany: vi.fn() },
  };
  const prismaMock = {
    people: { findFirst: vi.fn() },
    company: { findUniqueOrThrow: vi.fn() },
    clientAccount: { count: vi.fn() },
    portalAccessLink: { findUnique: vi.fn() },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const auditMock = { record: vi.fn() };
  const authMock = {
    openSession: vi.fn(),
    hashPassword: vi.fn(),
    phoneOrFail: vi.fn(),
  };
  const companyMock = { findBySlug: vi.fn() };
  const service = new PortalAccessService(
    prismaMock as unknown as PrismaService,
    auditMock as unknown as AuditService,
    authMock as unknown as PortalAuthService,
    companyMock as unknown as PortalCompanyService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.people.findFirst.mockResolvedValue({ id: "cli-1" });
    prismaMock.company.findUniqueOrThrow.mockResolvedValue({
      subdomain: "aurora",
    });
    companyMock.findBySlug.mockResolvedValue({
      id: COMPANY_ID,
      name: "Studio Aurora",
    });
    tx.portalAccessLink.updateMany.mockResolvedValue({ count: 1 });
    authMock.hashPassword.mockResolvedValue("hash-novo");
    authMock.openSession.mockResolvedValue({ token: "sessao" });
  });

  describe("createLink", () => {
    it("invalida o link anterior, grava só o hash, audita e devolve o caminho no app", async () => {
      const result = await service.createLink("cli-1", adminUser, "1.2.3.4");

      expect(tx.portalAccessLink.updateMany).toHaveBeenCalledWith({
        where: { peopleId: "cli-1", usedAt: null },
        data: { usedAt: expect.any(Date) as Date },
      });
      const [{ data }] = tx.portalAccessLink.create.mock.calls[0] as [
        { data: { tokenHash: string; peopleId: string; companyId: string } },
      ];
      expect(data).toMatchObject({ peopleId: "cli-1", companyId: COMPANY_ID });
      expect(data.tokenHash).toBe(hashSessionToken(result.token));
      expect(result.path).toBe(`/app/acesso/${result.token}`);
      expect(auditMock.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "PORTAL_ACCESS_LINK_CREATED",
          entityId: "cli-1",
          userId: adminUser.id,
        }),
        tx,
      );
    });

    it("procura só cliente ativo da empresa do usuário", async () => {
      await service.createLink("cli-1", adminUser);
      expect(prismaMock.people.findFirst).toHaveBeenCalledWith({
        where: {
          id: "cli-1",
          companyId: COMPANY_ID,
          type: "CLIENT",
          deletedAt: null,
        },
        select: { id: true },
      });
    });

    it("não é cliente ativo da empresa: 404", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);
      await expect(service.createLink("x", adminUser)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("portal desligado: 409, sem gerar", async () => {
      companyMock.findBySlug.mockRejectedValueOnce(new NotFoundException());
      await expect(
        service.createLink("cli-1", adminUser),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.portalAccessLink.create).not.toHaveBeenCalled();
    });
  });

  const link = (people: object = {}, overrides: object = {}) => ({
    id: "l-1",
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    company: { subdomain: "aurora" },
    people: {
      id: "cli-1",
      name: "Ana Souza",
      deletedAt: null,
      clientAccountId: null,
      contacts: [{ phone: "31988887777" }],
      ...people,
    },
    ...overrides,
  });
  const ACCOUNT = { sessionId: "s-1", accountId: "acc-1" };

  describe("check", () => {
    it("cadastro com telefone e sem conta: não pede telefone, senha cria a conta", async () => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(link());
      prismaMock.clientAccount.count.mockResolvedValue(0);

      await expect(service.check("token-do-link")).resolves.toEqual({
        place: { slug: "aurora", name: "Studio Aurora", logoUrl: undefined },
        clientName: "Ana Souza",
        needsPhone: false,
        hasAccount: false,
      });
      expect(prismaMock.portalAccessLink.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: hashSessionToken("token-do-link") },
        }),
      );
      expect(prismaMock.clientAccount.count).toHaveBeenCalledWith({
        where: { phone: "31988887777" },
      });
    });

    it("cadastro sem telefone: pede o telefone", async () => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(
        link({ contacts: [] }),
      );
      await expect(service.check("t")).resolves.toMatchObject({
        needsPhone: true,
        hasAccount: false,
      });
    });

    it("cadastro já ligado: a senha será a nova senha da conta", async () => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(
        link({ clientAccountId: "acc-9", contacts: [] }),
      );
      await expect(service.check("t")).resolves.toMatchObject({
        needsPhone: false,
        hasAccount: true,
      });
    });

    it.each([
      ["inexistente", null],
      ["já usado", link({}, { usedAt: new Date() })],
      ["vencido", link({}, { expiresAt: new Date(Date.now() - 1) })],
      ["de cliente inativo", link({ deletedAt: new Date() })],
    ])("link %s: 400", async (_, value) => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(value);
      await expect(service.check("t")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("portal fechado depois de gerar: o link deixa de valer", async () => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(link());
      companyMock.findBySlug.mockRejectedValueOnce(new NotFoundException());
      await expect(service.check("t")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe("use", () => {
    it("conta entrada: liga o cadastro à conta, sem abrir outra sessão", async () => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(link());

      const result = await service.use({ token: "t" }, ACCOUNT);

      expect(tx.people.update).toHaveBeenCalledWith({
        where: { id: "cli-1" },
        data: { clientAccountId: "acc-1" },
      });
      expect(authMock.openSession).not.toHaveBeenCalled();
      expect(result).toEqual({
        place: { slug: "aurora", name: "Studio Aurora", logoUrl: undefined },
      });
    });

    it("conta entrada, cadastro ligado a outra conta: 409", async () => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(
        link({ clientAccountId: "acc-9" }),
      );
      await expect(service.use({ token: "t" }, ACCOUNT)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.portalAccessLink.updateMany).not.toHaveBeenCalled();
    });

    it("sem conta e sem senha: 400", async () => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(link());
      await expect(service.use({ token: "t" }, null)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("sem conta para o telefone da clínica: cria a conta com o nome do cadastro e liga", async () => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(link());
      tx.clientAccount.findUnique.mockResolvedValue(null);
      tx.clientAccount.create.mockResolvedValue({ id: "acc-novo" });

      const result = await service.use(
        { token: "t", password: "senha-forte" },
        null,
        "Chrome",
      );

      expect(tx.clientAccount.create).toHaveBeenCalledWith({
        data: {
          phone: "31988887777",
          name: "Ana Souza",
          passwordHash: "hash-novo",
        },
        select: { id: true },
      });
      expect(tx.people.update).toHaveBeenCalledWith({
        where: { id: "cli-1" },
        data: { clientAccountId: "acc-novo" },
      });
      expect(authMock.openSession).toHaveBeenCalledWith(
        "acc-novo",
        "Chrome",
        tx,
      );
      expect(result).toMatchObject({
        token: "sessao",
        place: { slug: "aurora" },
      });
    });

    it("cadastro já ligado: o link troca a senha da conta e tira os outros aparelhos", async () => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(
        link({ clientAccountId: "acc-9" }),
      );

      await service.use({ token: "t", password: "senha-forte" }, null);

      expect(tx.clientAccount.update).toHaveBeenCalledWith({
        where: { id: "acc-9" },
        data: {
          passwordHash: "hash-novo",
          updatedAt: expect.any(Date) as Date,
        },
      });
      expect(tx.portalSession.updateMany).toHaveBeenCalledWith({
        where: { clientAccountId: "acc-9", revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
      expect(authMock.openSession).toHaveBeenCalledWith("acc-9", undefined, tx);
    });

    it("telefone da clínica já tem conta: junta com ela e troca a senha", async () => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(link());
      tx.clientAccount.findUnique.mockResolvedValue({ id: "acc-7" });

      await service.use({ token: "t", password: "senha-forte" }, null);

      expect(tx.clientAccount.create).not.toHaveBeenCalled();
      expect(tx.clientAccount.update).toHaveBeenCalled();
      expect(tx.people.update).toHaveBeenCalledWith({
        where: { id: "cli-1" },
        data: { clientAccountId: "acc-7" },
      });
    });

    it("telefone digitado já tem conta: 409 (pode ser de outra pessoa)", async () => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(
        link({ contacts: [] }),
      );
      authMock.phoneOrFail.mockReturnValue("31911112222");
      tx.clientAccount.findUnique.mockResolvedValue({ id: "acc-7" });

      await expect(
        service.use(
          { token: "t", password: "senha-forte", phone: "31911112222" },
          null,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.people.update).not.toHaveBeenCalled();
    });

    it("dois cliques ao mesmo tempo: só um usa o link", async () => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(link());
      tx.portalAccessLink.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.use({ token: "t", password: "senha-forte" }, null),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(authMock.openSession).not.toHaveBeenCalled();
    });
  });
});
