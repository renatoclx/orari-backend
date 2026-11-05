import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client";
import type { LocalFileStorage } from "../../common/storage/local-file-storage.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { PortalAuthService } from "./portal-auth.service";
import { PortalProfileService } from "./portal-profile.service";

const ACCOUNT = { sessionId: "s-1", accountId: "acc-1" };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const dto = (overrides: object = {}) => ({
  name: "Ana Souza",
  phone: "31988887777",
  email: "ana@exemplo.com",
  document: "12345678909",
  birthDate: new Date("1990-03-15"),
  profession: "Professora",
  address: {
    cep: "30110000",
    street: "Rua A",
    number: "10",
    complement: null,
    neighborhood: "Centro",
    cityId: "city-1",
  },
  ...overrides,
});

describe("PortalProfileService", () => {
  const prismaMock = {
    clientAccount: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    people: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    contact: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    address: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    city: { findUnique: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  const storageMock = { save: vi.fn(), remove: vi.fn() };
  const authMock = {
    phoneOrFail: vi.fn((raw: string) => raw.replace(/\D/g, "")),
  };
  const service = new PortalProfileService(
    prismaMock as unknown as PrismaService,
    storageMock as unknown as LocalFileStorage,
    authMock as unknown as PortalAuthService,
  );
  let hash: string;

  beforeAll(async () => {
    hash = await bcrypt.hash("senha-certa", 4);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Transação: a função recebe o próprio mock; a lista de operações só resolve.
    prismaMock.$transaction.mockImplementation((work: unknown) =>
      typeof work === "function"
        ? (work as (tx: typeof prismaMock) => unknown)(prismaMock)
        : Promise.all(work as unknown[]),
    );
    prismaMock.clientAccount.findUniqueOrThrow.mockResolvedValue({
      phone: "31988887777",
      passwordHash: hash,
      photoUrl: "/uploads/client-accounts/velha.jpg",
      name: "Ana Souza",
      email: null,
      document: null,
      birthDate: null,
      profession: null,
      addressCep: null,
      addressStreet: null,
      addressNumber: null,
      addressComplement: null,
      addressNeighborhood: null,
      addressCity: null,
    });
    prismaMock.people.findMany.mockResolvedValue([
      { id: "p-1", companyId: "c-1", photoUrl: "/uploads/people/p1.jpg" },
      { id: "p-2", companyId: "c-2", photoUrl: null },
    ]);
    prismaMock.people.findFirst.mockResolvedValue(null);
    prismaMock.city.findUnique.mockResolvedValue({ id: "city-1" });
    prismaMock.contact.findFirst.mockResolvedValue(null);
    prismaMock.address.findFirst.mockResolvedValue(null);
    storageMock.save.mockImplementation((folder: string) =>
      Promise.resolve(`/uploads/${folder}/nova.png`),
    );
  });

  describe("update", () => {
    it("salva a conta e copia para o cadastro em cada clínica", async () => {
      await service.update(ACCOUNT, dto());

      expect(prismaMock.clientAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "acc-1" },
          data: expect.objectContaining({
            name: "Ana Souza",
            document: "12345678909",
            addressCityId: "city-1",
          }) as unknown,
        }),
      );
      expect(prismaMock.people.update).toHaveBeenCalledTimes(2);
      expect(prismaMock.people.update).toHaveBeenCalledWith({
        where: { id: "p-1" },
        data: expect.objectContaining({
          name: "Ana Souza",
          normalizedName: "ana souza",
          document: "12345678909",
          profession: "Professora",
        }) as unknown,
      });
      // Sem contato e endereço principais na clínica: cria os dois.
      expect(prismaMock.contact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          phone: "31988887777",
          email: "ana@exemplo.com",
          isPrincipal: true,
          peopleId: "p-1",
        }) as unknown,
      });
      expect(prismaMock.address.create).toHaveBeenCalledTimes(2);
    });

    it("com contato e endereço principais na clínica: atualiza os dois", async () => {
      prismaMock.contact.findFirst.mockResolvedValue({ id: "ct-1" });
      prismaMock.address.findFirst.mockResolvedValue({ id: "ad-1" });
      await service.update(ACCOUNT, dto());
      expect(prismaMock.contact.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "ct-1" } }),
      );
      expect(prismaMock.address.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "ad-1" } }),
      );
      expect(prismaMock.contact.create).not.toHaveBeenCalled();
    });

    it("sem endereço no app: o endereço da clínica não é tocado", async () => {
      await service.update(ACCOUNT, dto({ address: null }));
      expect(prismaMock.address.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.address.create).not.toHaveBeenCalled();
    });

    it("trocar o telefone sem a senha atual: 400", async () => {
      await expect(
        service.update(ACCOUNT, dto({ phone: "31911112222" })),
      ).rejects.toThrow("Para trocar o telefone, informe a senha atual");
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("trocar o telefone com a senha errada: 400; com a certa, salva", async () => {
      await expect(
        service.update(
          ACCOUNT,
          dto({ phone: "31911112222", currentPassword: "errada" }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      await service.update(
        ACCOUNT,
        dto({ phone: "31911112222", currentPassword: "senha-certa" }),
      );
      expect(prismaMock.clientAccount.update).toHaveBeenCalled();
    });

    it("CPF em outro cadastro de uma das clínicas: 409 com o nome dela, sem salvar", async () => {
      prismaMock.people.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          company: { fantasyName: "Zeta Barbearia", corporateReason: "Zeta" },
        });
      await expect(service.update(ACCOUNT, dto())).rejects.toThrow(
        "Este CPF já está em outro cadastro de Zeta Barbearia. Fale com o estabelecimento.",
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("cidade inexistente: 404", async () => {
      prismaMock.city.findUnique.mockResolvedValue(null);
      await expect(service.update(ACCOUNT, dto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("telefone de outra conta (único no banco): 409", async () => {
      prismaMock.clientAccount.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("único", {
          code: "P2002",
          clientVersion: "7",
        }),
      );
      await expect(
        service.update(
          ACCOUNT,
          dto({ phone: "31911112222", currentPassword: "senha-certa" }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("foto", () => {
    it("não é JPEG nem PNG: 400, sem gravar", async () => {
      await expect(
        service.updatePhoto(ACCOUNT, Buffer.from("texto")),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storageMock.save).not.toHaveBeenCalled();
    });

    it("grava a da conta e uma cópia por clínica, e só depois apaga as antigas", async () => {
      await service.updatePhoto(ACCOUNT, PNG);

      expect(storageMock.save).toHaveBeenCalledWith(
        "client-accounts",
        PNG,
        "png",
      );
      expect(
        storageMock.save.mock.calls.filter(([folder]) => folder === "people"),
      ).toHaveLength(2);
      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(storageMock.remove).toHaveBeenCalledWith(
        "/uploads/client-accounts/velha.jpg",
      );
      expect(storageMock.remove).toHaveBeenCalledWith("/uploads/people/p1.jpg");
      expect(storageMock.remove).toHaveBeenCalledTimes(2);
    });

    it("tirar a foto: limpa a conta e as clínicas e apaga os arquivos", async () => {
      await service.removePhoto(ACCOUNT);
      expect(prismaMock.people.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["p-1", "p-2"] } },
        data: { photoUrl: null, updatedAt: expect.any(Date) as Date },
      });
      expect(storageMock.remove).toHaveBeenCalledTimes(2);
    });
  });

  it("get: endereço só quando completo", async () => {
    await expect(service.get(ACCOUNT)).resolves.toMatchObject({
      name: "Ana Souza",
      address: null,
    });
  });

  describe("findCity", () => {
    it("pelo nome sem acentos e pela UF", async () => {
      prismaMock.city.findFirst.mockResolvedValue({
        id: "city-1",
        name: "São Paulo",
        state: { acronym: "SP" },
      });
      await expect(service.findCity("SÃO PAULO", "sp")).resolves.toEqual({
        id: "city-1",
        name: "São Paulo",
        state: "SP",
      });
      expect(prismaMock.city.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { normalizedName: "sao paulo", state: { acronym: "SP" } },
        }),
      );
    });

    it("não achou: 404", async () => {
      prismaMock.city.findFirst.mockResolvedValue(null);
      await expect(service.findCity("Xyz", "MG")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
