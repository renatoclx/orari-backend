import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { LocalFileStorage } from "../../common/storage/local-file-storage.service";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { CreatePeopleDto } from "./dto/create-people.dto";
import { PeopleService } from "./people.service";

const anyDate: unknown = expect.any(Date);

describe("PeopleService", () => {
  let peopleService: PeopleService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    people: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };

  const storageMock = { save: vi.fn(), remove: vi.fn() };

  const dto: CreatePeopleDto = {
    name: "Maria",
    document: "52998224725",
    birthDate: new Date("1990-05-20"),
    type: "CLIENT",
  };
  const people = { id: "1", ...dto, companyId: COMPANY_ID, deletedAt: null };
  const principalContact = {
    id: "contact-1",
    type: "MAIN",
    phone: "31999999999",
    email: null,
  };
  const principalAddress = { id: "address-1", street: "Rua da Bahia" };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeopleService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: LocalFileStorage, useValue: storageMock },
      ],
    }).compile();

    peopleService = module.get<PeopleService>(PeopleService);
  });

  describe("create", () => {
    it("deve criar a pessoa na empresa do usuário", async () => {
      prismaMock.people.create.mockResolvedValue(people);

      await expect(peopleService.create(dto, COMPANY_ID)).resolves.toEqual(
        people,
      );
      expect(prismaMock.people.create).toHaveBeenCalledWith({
        data: { ...dto, normalizedName: "maria", companyId: COMPANY_ID },
        omit: { normalizedName: true },
      });
    });

    it("deve lançar ConflictException para documento repetido na empresa", async () => {
      prismaMock.people.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(
        peopleService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("findAll", () => {
    it("deve combinar o escopo da empresa com os filtros", async () => {
      prismaMock.people.findMany.mockResolvedValue([
        { ...people, contacts: [principalContact] },
      ]);
      prismaMock.people.count.mockResolvedValue(1);

      const result = await peopleService.findAll(
        {
          page: 1,
          limit: 10,
          name: "MÁR",
          document: "52998224725",
          type: "CLIENT",
        },
        COMPANY_ID,
      );

      expect(prismaMock.people.count).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY_ID,
          deletedAt: null,
          normalizedName: { contains: "mar" },
          document: "52998224725",
          type: "CLIENT",
        },
      });
      expect(result).toEqual({
        items: [{ ...people, principalContact }],
        total: 1,
        page: 1,
        limit: 10,
      });
    });

    it("deve trazer só o contato principal não excluído de cada pessoa", async () => {
      prismaMock.people.findMany.mockResolvedValue([
        { ...people, contacts: [] },
      ]);
      prismaMock.people.count.mockResolvedValue(1);

      const result = await peopleService.findAll(
        { page: 1, limit: 10 },
        COMPANY_ID,
      );

      expect(prismaMock.people.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            contacts: expect.objectContaining({
              where: { isPrincipal: true, deletedAt: null },
              take: 1,
            }) as unknown,
          },
        }),
      );
      expect(result.items).toEqual([{ ...people, principalContact: null }]);
    });

    it("não deve filtrar por nome quando ele não é informado", async () => {
      prismaMock.people.findMany.mockResolvedValue([]);
      prismaMock.people.count.mockResolvedValue(0);

      await peopleService.findAll({ page: 1, limit: 10 }, COMPANY_ID);

      expect(prismaMock.people.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          normalizedName: undefined,
        }) as unknown,
      });
    });
  });

  describe("findDetail", () => {
    it("deve devolver a pessoa com contato e endereço principais", async () => {
      prismaMock.people.findFirst.mockResolvedValue({
        ...people,
        contacts: [principalContact],
        addresses: [principalAddress],
      });

      await expect(peopleService.findDetail("1", COMPANY_ID)).resolves.toEqual({
        ...people,
        principalContact,
        principalAddress,
      });
      expect(prismaMock.people.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "1", companyId: COMPANY_ID, deletedAt: null },
        }),
      );
    });

    it("deve devolver null quando não há principais marcados", async () => {
      prismaMock.people.findFirst.mockResolvedValue({
        ...people,
        contacts: [],
        addresses: [],
      });

      await expect(peopleService.findDetail("1", COMPANY_ID)).resolves.toEqual({
        ...people,
        principalContact: null,
        principalAddress: null,
      });
    });

    it("deve lançar NotFoundException para pessoa fora da empresa", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);

      await expect(
        peopleService.findDetail("1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("findOne", () => {
    it("deve restringir a busca à empresa do usuário", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);

      await expect(
        peopleService.findOne("1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.people.findFirst).toHaveBeenCalledWith({
        where: { id: "1", companyId: COMPANY_ID, deletedAt: null },
        omit: { normalizedName: true },
      });
    });
  });

  describe("update", () => {
    it("deve atualizar registrando o updatedAt", async () => {
      prismaMock.people.findFirst.mockResolvedValue(people);
      prismaMock.people.update.mockResolvedValue(people);

      await peopleService.update("1", { name: "Maria Conceição" }, COMPANY_ID);

      expect(prismaMock.people.update).toHaveBeenCalledWith({
        where: { id: "1" },
        data: {
          name: "Maria Conceição",
          normalizedName: "maria conceicao",
          updatedAt: anyDate,
        },
        omit: { normalizedName: true },
      });
    });

    it("não deve mexer no nome normalizado quando o nome não muda", async () => {
      prismaMock.people.findFirst.mockResolvedValue(people);

      await peopleService.update("1", { profession: "Médica" }, COMPANY_ID);

      expect(prismaMock.people.update).toHaveBeenCalledWith({
        where: { id: "1" },
        data: { profession: "Médica", updatedAt: anyDate },
        omit: { normalizedName: true },
      });
    });

    it("não deve atualizar pessoa de outra empresa", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);

      await expect(
        peopleService.update("1", { name: "X" }, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.people.update).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("deve excluir logicamente a pessoa", async () => {
      prismaMock.people.findFirst.mockResolvedValue(people);

      await peopleService.remove("1", COMPANY_ID);

      expect(prismaMock.people.update).toHaveBeenCalledWith({
        where: { id: "1" },
        data: { deletedAt: anyDate, updatedAt: anyDate },
      });
    });
  });

  describe("foto", () => {
    // Assinaturas mínimas de cada formato (os primeiros bytes do arquivo).
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const gif = Buffer.from("GIF89a");

    beforeEach(() => {
      prismaMock.people.findFirst.mockResolvedValue({
        ...people,
        photoUrl: null,
      });
      storageMock.save.mockResolvedValue("/uploads/people/new.jpg");
      prismaMock.people.update.mockResolvedValue({
        ...people,
        photoUrl: "/uploads/people/new.jpg",
      });
    });

    it("deve gravar a foto JPEG e preencher o photoUrl", async () => {
      const result = await peopleService.updatePhoto("1", jpeg, COMPANY_ID);

      expect(storageMock.save).toHaveBeenCalledWith("people", jpeg, "jpg");
      expect(prismaMock.people.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "1" },
          data: { photoUrl: "/uploads/people/new.jpg", updatedAt: anyDate },
        }),
      );
      expect(result.photoUrl).toBe("/uploads/people/new.jpg");
      expect(storageMock.remove).not.toHaveBeenCalled();
    });

    it("deve aceitar PNG com a extensão correta", async () => {
      await peopleService.updatePhoto("1", png, COMPANY_ID);

      expect(storageMock.save).toHaveBeenCalledWith("people", png, "png");
    });

    it("deve recusar formato que não é JPEG nem PNG, sem gravar nada", async () => {
      await expect(
        peopleService.updatePhoto("1", gif, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storageMock.save).not.toHaveBeenCalled();
      expect(prismaMock.people.update).not.toHaveBeenCalled();
    });

    it("deve apagar a foto anterior só depois de gravar a nova", async () => {
      prismaMock.people.findFirst.mockResolvedValue({
        ...people,
        photoUrl: "/uploads/people/old.jpg",
      });

      await peopleService.updatePhoto("1", jpeg, COMPANY_ID);

      expect(storageMock.remove).toHaveBeenCalledWith(
        "/uploads/people/old.jpg",
      );
      expect(prismaMock.people.update.mock.invocationCallOrder[0]).toBeLessThan(
        storageMock.remove.mock.invocationCallOrder[0],
      );
    });

    it("deve recusar foto de pessoa de outra empresa", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);

      await expect(
        peopleService.updatePhoto("1", jpeg, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storageMock.save).not.toHaveBeenCalled();
    });

    it("deve remover a foto: limpa o photoUrl e apaga o arquivo", async () => {
      prismaMock.people.findFirst.mockResolvedValue({
        ...people,
        photoUrl: "/uploads/people/old.jpg",
      });

      await peopleService.removePhoto("1", COMPANY_ID);

      expect(prismaMock.people.update).toHaveBeenCalledWith({
        where: { id: "1" },
        data: { photoUrl: null, updatedAt: anyDate },
      });
      expect(storageMock.remove).toHaveBeenCalledWith(
        "/uploads/people/old.jpg",
      );
    });

    it("não deve fazer nada ao remover quando a pessoa não tem foto", async () => {
      await peopleService.removePhoto("1", COMPANY_ID);

      expect(prismaMock.people.update).not.toHaveBeenCalled();
      expect(storageMock.remove).not.toHaveBeenCalled();
    });
  });
});
