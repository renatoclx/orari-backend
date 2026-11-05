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
  };
  const prismaMock = {
    people: { findFirst: vi.fn() },
    company: { findUniqueOrThrow: vi.fn() },
    portalAccessLink: { findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const auditMock = { record: vi.fn() };
  const authMock = { openSession: vi.fn() };
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
    prismaMock.portalAccessLink.updateMany.mockResolvedValue({ count: 1 });
  });

  describe("createLink", () => {
    it("invalida o link anterior, grava só o hash, audita e devolve o caminho do portal", async () => {
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
      expect(result.path).toBe(`/p/aurora/acesso/${result.token}`);
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

  describe("exchange", () => {
    const link = (overrides: object = {}) => ({
      id: "l-1",
      companyId: COMPANY_ID,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      people: { id: "cli-1", name: "Ana", deletedAt: null },
      ...overrides,
    });

    it("link válido: marca como usado e abre a sessão do cliente", async () => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(link());
      authMock.openSession.mockResolvedValue({ token: "t" });

      await service.exchange("aurora", "token-do-link", "Chrome");

      expect(prismaMock.portalAccessLink.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: hashSessionToken("token-do-link") },
        }),
      );
      expect(authMock.openSession).toHaveBeenCalledWith(
        COMPANY_ID,
        { id: "cli-1", name: "Ana" },
        "Chrome",
      );
    });

    it.each([
      ["inexistente", null],
      ["de outra clínica", link({ companyId: "company-2" })],
      ["já usado", link({ usedAt: new Date() })],
      ["vencido", link({ expiresAt: new Date(Date.now() - 1) })],
      [
        "de cliente inativo",
        link({ people: { id: "cli-1", name: "Ana", deletedAt: new Date() } }),
      ],
    ])("link %s: 400, sem abrir sessão", async (_, value) => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(value);
      await expect(service.exchange("aurora", "t")).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(authMock.openSession).not.toHaveBeenCalled();
    });

    it("dois cliques ao mesmo tempo: só um abre a sessão", async () => {
      prismaMock.portalAccessLink.findUnique.mockResolvedValue(link());
      prismaMock.portalAccessLink.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.exchange("aurora", "t")).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(authMock.openSession).not.toHaveBeenCalled();
    });
  });
});
