import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";
import { hashSessionToken } from "./portal-code";
import { NOT_A_CLIENT, PortalAuthService } from "./portal-auth.service";
import type { PortalCompanyService } from "./portal-company.service";

const PHONE = "31988887777";
const ACCOUNT = { sessionId: "s-1", accountId: "acc-1" };
const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 1_000);

describe("PortalAuthService", () => {
  const prismaMock = {
    clientAccount: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    people: { findFirst: vi.fn() },
    portalSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  const portalCompanyMock = { findBySlug: vi.fn() };
  const service = new PortalAuthService(
    prismaMock as unknown as PrismaService,
    portalCompanyMock as unknown as PortalCompanyService,
  );
  let storedHash: string;

  beforeAll(async () => {
    storedHash = await bcrypt.hash("senha-certa", 4);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    portalCompanyMock.findBySlug.mockResolvedValue({
      id: "company-1",
      name: "Studio Aurora",
      logoUrl: null,
    });
  });

  describe("register", () => {
    const dto = {
      name: "Ana",
      phone: "(31) 98888-7777",
      password: "senha-forte",
      passwordConfirmation: "senha-forte",
    };

    it("cria a conta com o telefone só em dígitos e a senha com hash, e abre a sessão", async () => {
      prismaMock.clientAccount.create.mockResolvedValue({ id: "acc-1" });

      const result = await service.register(dto, "Chrome");

      const [{ data }] = prismaMock.clientAccount.create.mock.calls[0] as [
        { data: { phone: string; name: string; passwordHash: string } },
      ];
      expect(data).toMatchObject({ phone: PHONE, name: "Ana" });
      await expect(
        bcrypt.compare("senha-forte", data.passwordHash),
      ).resolves.toBe(true);
      const [{ data: session }] = prismaMock.portalSession.create.mock
        .calls[0] as [{ data: { clientAccountId: string; tokenHash: string } }];
      expect(session.clientAccountId).toBe("acc-1");
      expect(session.tokenHash).toBe(hashSessionToken(result.token));
    });

    it("telefone inválido: 400, sem gravar", async () => {
      await expect(
        service.register({ ...dto, phone: "123" }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.clientAccount.create).not.toHaveBeenCalled();
    });

    it("telefone já usado por outra conta: 409", async () => {
      prismaMock.clientAccount.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("único", {
          code: "P2002",
          clientVersion: "7",
        }),
      );
      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe("login", () => {
    it("telefone e senha certos: abre a sessão da conta", async () => {
      prismaMock.clientAccount.findUnique.mockResolvedValue({
        id: "acc-1",
        passwordHash: storedHash,
      });

      await service.login({
        phone: "+55 31 98888-7777",
        password: "senha-certa",
      });

      expect(prismaMock.clientAccount.findUnique).toHaveBeenCalledWith({
        where: { phone: PHONE },
        select: { id: true, passwordHash: true },
      });
      expect(prismaMock.portalSession.create).toHaveBeenCalled();
    });

    it.each([
      ["senha errada", { id: "acc-1" }, "senha-errada"],
      ["telefone sem conta", null, "senha-certa"],
    ])("%s: o mesmo 401", async (_, account, password) => {
      prismaMock.clientAccount.findUnique.mockResolvedValue(
        account && { ...account, passwordHash: storedHash },
      );
      await expect(service.login({ phone: PHONE, password })).rejects.toThrow(
        "Telefone ou senha inválidos",
      );
      expect(prismaMock.portalSession.create).not.toHaveBeenCalled();
    });
  });

  describe("authenticate", () => {
    const session = (overrides: object = {}) => ({
      id: "s-1",
      clientAccountId: "acc-1",
      revokedAt: null,
      expiresAt: future(),
      ...overrides,
    });

    it("sessão válida: devolve a conta", async () => {
      prismaMock.portalSession.findUnique.mockResolvedValue(session());
      await expect(service.authenticate("token")).resolves.toEqual(ACCOUNT);
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
    ])("sessão %s: 401", async (_, overrides) => {
      prismaMock.portalSession.findUnique.mockResolvedValue(
        overrides === null ? null : session(overrides),
      );
      await expect(service.authenticate("token")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe("resolveClient", () => {
    it("acha o cadastro ativo da conta na clínica do endereço", async () => {
      prismaMock.people.findFirst.mockResolvedValue({ id: "cli-1" });

      await expect(service.resolveClient(ACCOUNT, "aurora")).resolves.toEqual({
        ...ACCOUNT,
        companyId: "company-1",
        peopleId: "cli-1",
      });
      expect(prismaMock.people.findFirst).toHaveBeenCalledWith({
        where: {
          companyId: "company-1",
          clientAccountId: "acc-1",
          type: "CLIENT",
          deletedAt: null,
        },
        select: { id: true },
      });
    });

    it("sem cadastro nesta clínica: 403 NOT_A_CLIENT", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);
      const error = await service
        .resolveClient(ACCOUNT, "aurora")
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: NOT_A_CLIENT,
      });
    });

    it("portal fechado: 404, sem procurar o cadastro", async () => {
      portalCompanyMock.findBySlug.mockRejectedValueOnce(
        new NotFoundException(),
      );
      await expect(
        service.resolveClient(ACCOUNT, "aurora"),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.people.findFirst).not.toHaveBeenCalled();
    });
  });

  it("me: devolve a conta e só os locais com o portal aberto, em ordem alfabética", async () => {
    prismaMock.clientAccount.findUniqueOrThrow.mockResolvedValue({
      id: "acc-1",
      name: "Ana",
      phone: PHONE,
      people: [
        { company: { subdomain: "zeta" } },
        { company: { subdomain: "fechada" } },
        { company: { subdomain: "aurora" } },
      ],
    });
    portalCompanyMock.findBySlug.mockImplementation((slug: string) =>
      slug === "fechada"
        ? Promise.reject(new NotFoundException())
        : Promise.resolve({
            name: slug === "zeta" ? "Zeta" : "Aurora",
            logoUrl: null,
          }),
    );

    await expect(service.me(ACCOUNT)).resolves.toEqual({
      account: { id: "acc-1", name: "Ana", phone: PHONE },
      places: [
        { slug: "aurora", name: "Aurora", logoUrl: null },
        { slug: "zeta", name: "Zeta", logoUrl: null },
      ],
    });
  });

  describe("changePassword", () => {
    const dto = {
      currentPassword: "senha-certa",
      newPassword: "senha-nova-1",
      newPasswordConfirmation: "senha-nova-1",
    };

    beforeEach(() => {
      prismaMock.clientAccount.findUniqueOrThrow.mockResolvedValue({
        passwordHash: storedHash,
      });
    });

    it("senha atual certa: grava a nova e tira só os outros aparelhos", async () => {
      await service.changePassword(ACCOUNT, dto);

      const [{ data }] = prismaMock.clientAccount.update.mock.calls[0] as [
        { data: { passwordHash: string } },
      ];
      await expect(
        bcrypt.compare("senha-nova-1", data.passwordHash),
      ).resolves.toBe(true);
      expect(prismaMock.portalSession.updateMany).toHaveBeenCalledWith({
        where: {
          clientAccountId: "acc-1",
          revokedAt: null,
          id: { not: "s-1" },
        },
        data: { revokedAt: expect.any(Date) as Date },
      });
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });

    it("senha atual errada: 400, sem gravar", async () => {
      await expect(
        service.changePassword(ACCOUNT, { ...dto, currentPassword: "errada" }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  it("logout revoga só a sessão deste aparelho", async () => {
    await service.logout(ACCOUNT);
    expect(prismaMock.portalSession.update).toHaveBeenCalledWith({
      where: { id: "s-1" },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });
});
