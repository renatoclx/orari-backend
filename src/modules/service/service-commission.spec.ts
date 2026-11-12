import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import type { PrismaService } from "../../prisma/prisma.service";
import { ensureCanSetCommission, forUser } from "./service.controller";
import {
  ServiceService,
  commissionSinceFor,
  resolveCommission,
  type PublicService,
} from "./service.service";

const admin = { type: "ADMIN" } as AuthenticatedUser;
const user = { type: "PROFESSIONAL" } as AuthenticatedUser;

describe("resolveCommission", () => {
  it("sem os campos, nada muda", () => {
    expect(resolveCommission({ name: "x" } as never)).toEqual({});
  });

  it("percentual e valor fixo", () => {
    expect(
      resolveCommission({ commissionType: "PERCENT", commissionValue: 40 }),
    ).toEqual({ commissionType: "PERCENT", commissionValue: 40 });
    expect(
      resolveCommission({ commissionType: "FIXED", commissionValue: 25.5 }),
    ).toEqual({ commissionType: "FIXED", commissionValue: 25.5 });
  });

  it("percentual acima de 100: 400", () => {
    expect(() =>
      resolveCommission({ commissionType: "PERCENT", commissionValue: 120 }),
    ).toThrow("O percentual da comissão vai até 100");
  });

  it("tipo sem valor e valor sem tipo: 400", () => {
    expect(() => resolveCommission({ commissionType: "FIXED" })).toThrow(
      "Informe o valor da comissão",
    );
    expect(() => resolveCommission({ commissionValue: 10 })).toThrow(
      "Informe o tipo da comissão",
    );
  });

  it("na alteração, completa com o que já está gravado", () => {
    const current = {
      commissionType: "PERCENT" as const,
      commissionValue: "40",
    };
    expect(resolveCommission({ commissionValue: 50 }, current)).toEqual({
      commissionType: "PERCENT",
      commissionValue: 50,
    });
    // Trocar para percentual com um fixo alto gravado é conferido de novo.
    expect(() =>
      resolveCommission(
        { commissionType: "PERCENT" },
        { commissionType: "FIXED", commissionValue: "150" },
      ),
    ).toThrow(BadRequestException);
  });

  it("tirar o tipo tira o valor", () => {
    expect(
      resolveCommission(
        { commissionType: null },
        { commissionType: "FIXED", commissionValue: "20" },
      ),
    ).toEqual({ commissionType: null, commissionValue: null });
  });
});

describe("ServiceService com comissão", () => {
  const prismaMock = {
    service: {
      create: vi.fn((args: { data: object }) => Promise.resolve(args.data)),
      findFirst: vi.fn(),
      update: vi.fn((args: { data: object }) => Promise.resolve(args.data)),
    },
  };
  const service = new ServiceService(prismaMock as unknown as PrismaService);

  it("o cadastro grava a comissão", async () => {
    await service.create(
      {
        name: "Pilates",
        duration: 50,
        commissionType: "PERCENT",
        commissionValue: 40,
      },
      "c-1",
    );
    expect(prismaMock.service.create.mock.calls[0][0].data).toMatchObject({
      commissionType: "PERCENT",
      commissionValue: 40,
    });
  });

  it("a alteração inválida não grava nada", async () => {
    prismaMock.service.findFirst.mockResolvedValue({
      id: "s-1",
      allowsClasses: false,
      commissionType: null,
      commissionValue: null,
    });
    await expect(
      service.update("s-1", { commissionValue: 10 }, "c-1"),
    ).rejects.toThrow("Informe o tipo da comissão");
    expect(prismaMock.service.update).not.toHaveBeenCalled();
  });
});

describe("só o ADMIN define e vê a comissão", () => {
  it("usuário comum mandando a comissão: 403; sem ela, passa", () => {
    expect(() =>
      ensureCanSetCommission({ commissionType: null }, user),
    ).toThrow(ForbiddenException);
    expect(() => ensureCanSetCommission({}, user)).not.toThrow();
    expect(() =>
      ensureCanSetCommission({ commissionValue: 10 }, admin),
    ).not.toThrow();
  });

  it("a resposta tira os campos para o usuário comum", () => {
    const row = {
      id: "s-1",
      name: "Pilates",
      commissionType: "PERCENT",
      commissionValue: "40",
      commissionSince: new Date(),
    } as unknown as PublicService;
    expect(forUser(row, admin)).toBe(row);
    expect(forUser(row, user)).toEqual({ id: "s-1", name: "Pilates" });
  });
});

describe("commissionSinceFor", () => {
  const now = new Date("2026-11-10T15:00:00Z");

  it("ganha a data ao sair de sem comissão; troca de tipo mantém", () => {
    expect(
      commissionSinceFor({ commissionType: "PERCENT" }, null, now),
    ).toEqual({
      commissionSince: now,
    });
    expect(
      commissionSinceFor({ commissionType: "FIXED" }, "PERCENT", now),
    ).toEqual({});
  });

  it("tirar a comissão tira a data; sem mudança, nada", () => {
    expect(commissionSinceFor({ commissionType: null }, "FIXED", now)).toEqual({
      commissionSince: null,
    });
    expect(commissionSinceFor({}, "FIXED", now)).toEqual({});
  });
});
