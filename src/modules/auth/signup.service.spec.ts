import { ConflictException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "./auth.service";
import type { SignupDto } from "./dto/signup.dto";
import { SignupService, slugify } from "./signup.service";

describe("slugify", () => {
  it("vira subdomínio: sem acento, minúsculo, hífens e até 40 letras", () => {
    expect(slugify("Studio Aurora & Cia.")).toBe("studio-aurora-cia");
    expect(slugify("Clínica Bem-Estar")).toBe("clinica-bem-estar");
    expect(slugify("!!!")).toBe("empresa");
    expect(slugify("a".repeat(60))).toHaveLength(40);
  });
});

// O que a transação mandou gravar (os mocks não têm tipo).
type Created = { data: Record<string, unknown> };

describe("SignupService", () => {
  let service: SignupService;
  const tx = {
    company: { create: vi.fn() },
    user: { create: vi.fn() },
  };
  const prismaMock = {
    user: { findFirst: vi.fn() },
    company: { findUnique: vi.fn() },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const auditMock = { record: vi.fn() };
  const companyData = () =>
    (tx.company.create.mock.calls[0] as [Created])[0].data;
  const userData = () => (tx.user.create.mock.calls[0] as [Created])[0].data;
  const authMock = { login: vi.fn() };

  const dto: SignupDto = {
    companyName: "Studio Aurora",
    document: "11444777000161",
    name: "Marina Alves",
    email: "marina@aurora.com",
    phone: "11999998888",
    password: "Senha#2026",
    plan: "PLUS",
    acceptTerms: true,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.company.findUnique.mockResolvedValue(null);
    tx.company.create.mockResolvedValue({ id: "company-new" });
    tx.user.create.mockResolvedValue({ id: "user-new" });
    authMock.login.mockResolvedValue({ accessToken: "a", refreshToken: "r" });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignupService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditService, useValue: auditMock },
        { provide: AuthService, useValue: authMock },
      ],
    }).compile();
    service = module.get(SignupService);
  });

  it("cria a empresa no plano, em teste de 7 dias, e entra", async () => {
    // Meio-dia de 17/11 em Brasília: o teste vai até 23/11.
    const tokens = await service.signup(dto, new Date("2026-11-17T15:00:00Z"));

    const data = companyData();
    expect(data).toMatchObject({
      corporateReason: "Studio Aurora",
      subdomain: "studio-aurora",
      timezone: "America/Sao_Paulo",
      limit: { create: { maxProfessionals: 5, maxAdmins: 2 } },
      subscription: {
        create: {
          plan: "PLUS",
          cycle: "MONTHLY",
          price: 89.9,
          trialEndsAt: new Date("2026-11-23T00:00:00Z"),
        },
      },
      contacts: { create: { phone: "11999998888", isPrincipal: true } },
    });
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "ADMIN",
          companyId: "company-new",
          email: "marina@aurora.com",
        }) as unknown,
      }),
    );
    // A senha vai com hash, nunca como veio.
    expect(userData().password).not.toBe(dto.password);
    expect(authMock.login).toHaveBeenCalledWith({
      email: dto.email,
      password: dto.password,
    });
    expect(tokens).toEqual({ accessToken: "a", refreshToken: "r" });
  });

  it("subdomínio ocupado ganha sufixo", async () => {
    prismaMock.company.findUnique.mockImplementation(
      ({ where }: { where: { subdomain?: string; document?: string } }) =>
        Promise.resolve(
          where.subdomain === "studio-aurora" ? { id: "x" } : null,
        ),
    );
    await service.signup(dto);
    expect(companyData().subdomain).toBe("studio-aurora-2");
  });

  it("e-mail ou documento já usados: 409 com o campo", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({ id: "u" });
    const emailError = await service.signup(dto).catch((e: unknown) => e);
    expect(emailError).toBeInstanceOf(ConflictException);
    expect((emailError as ConflictException).getResponse()).toMatchObject({
      field: "email",
    });

    prismaMock.company.findUnique.mockResolvedValueOnce({ id: "c" });
    const documentError = await service.signup(dto).catch((e: unknown) => e);
    expect((documentError as ConflictException).getResponse()).toMatchObject({
      field: "document",
    });
    expect(tx.company.create).not.toHaveBeenCalled();
  });
});
