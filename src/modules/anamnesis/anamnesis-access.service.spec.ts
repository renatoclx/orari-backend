import { ForbiddenException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminUser,
  COMPANY_ID,
  regularUser,
  superAdminUser,
} from "../../../test/fixtures/authenticated-users";
import { PrismaService } from "../../prisma/prisma.service";
import { AnamnesisAccessService } from "./anamnesis-access.service";

describe("AnamnesisAccessService", () => {
  let service: AnamnesisAccessService;
  const prismaMock = { people: { findFirst: vi.fn() } };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnamnesisAccessService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get(AnamnesisAccessService);
  });

  it("ADMIN tem acesso sem consultar vínculo", async () => {
    await expect(service.canAccess(adminUser)).resolves.toBe(true);
    expect(prismaMock.people.findFirst).not.toHaveBeenCalled();
  });

  it("usuário vinculado a profissional ativo da empresa tem acesso", async () => {
    prismaMock.people.findFirst.mockResolvedValue({ id: "people-1" });

    await expect(service.canAccess(regularUser)).resolves.toBe(true);
    // O profissional precisa ser ativo, da mesma empresa e ligado a este usuário ativo.
    expect(prismaMock.people.findFirst).toHaveBeenCalledWith({
      where: {
        companyId: COMPANY_ID,
        type: "PROFESSIONAL",
        deletedAt: null,
        users: { some: { id: regularUser.id, deletedAt: null } },
      },
      select: { id: true },
    });
  });

  it("usuário sem vínculo (ou com profissional inativo) não tem acesso", async () => {
    prismaMock.people.findFirst.mockResolvedValue(null);

    await expect(service.canAccess(regularUser)).resolves.toBe(false);
  });

  it("SUPER_ADMIN sem vínculo não tem acesso", async () => {
    prismaMock.people.findFirst.mockResolvedValue(null);

    await expect(service.canAccess(superAdminUser)).resolves.toBe(false);
  });

  it("ensureAccess recusa com 403 quando não há acesso", async () => {
    prismaMock.people.findFirst.mockResolvedValue(null);

    await expect(service.ensureAccess(regularUser)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("ensureAccess libera quando há acesso", async () => {
    await expect(service.ensureAccess(adminUser)).resolves.toBeUndefined();
  });
});
