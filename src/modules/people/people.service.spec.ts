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
import { CityService } from "../city/city.service";
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
  const cityServiceMock = { findOne: vi.fn() };

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
    cityServiceMock.findOne.mockResolvedValue({ id: "city-1" });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeopleService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: LocalFileStorage, useValue: storageMock },
        { provide: CityService, useValue: cityServiceMock },
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

  describe("cadastro completo", () => {
    const address = {
      type: "MAIN" as const,
      cep: "30130000",
      street: "Rua da Bahia",
      number: "100",
      cityId: "city-1",
    };

    beforeEach(() => {
      prismaMock.people.create.mockResolvedValue(people);
    });

    it("deve gravar o telefone principal à parte e a lista em lote, na mesma escrita", async () => {
      await peopleService.create(
        {
          ...dto,
          note: "Prefere manhã",
          phone: "31999999999",
          contacts: [
            { type: "MESSAGE", phone: "3133334444" },
            { type: "BRANCH", email: "filial@orari.local", isPrincipal: false },
          ],
          addresses: [{ ...address, isPrincipal: true }],
        },
        COMPANY_ID,
      );

      expect(prismaMock.people.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.people.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          note: "Prefere manhã",
          companyId: COMPANY_ID,
          contacts: {
            create: { type: "MAIN", phone: "31999999999", isPrincipal: true },
            createMany: {
              data: [
                {
                  type: "MESSAGE",
                  phone: "3133334444",
                  email: undefined,
                  isPrincipal: false,
                },
                {
                  type: "BRANCH",
                  phone: undefined,
                  email: "filial@orari.local",
                  isPrincipal: false,
                },
              ],
            },
          },
          addresses: {
            createMany: {
              data: [
                expect.objectContaining({
                  cep: "30130000",
                  cityId: "city-1",
                  isPrincipal: true,
                }),
              ],
            },
          },
        }) as unknown,
        omit: { normalizedName: true },
      });
    });

    it("não deve repassar telefone, contacts nem addresses como colunas da pessoa", async () => {
      await peopleService.create(
        { ...dto, phone: "31999999999", contacts: [], addresses: [] },
        COMPANY_ID,
      );

      const { data } = prismaMock.people.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data).not.toHaveProperty("phone");
      expect(data.addresses).toBeUndefined();
      expect(data.contacts).toEqual({
        create: { type: "MAIN", phone: "31999999999", isPrincipal: true },
      });
    });

    it("sem telefone nem listas, grava só a pessoa, como antes", async () => {
      await peopleService.create(dto, COMPANY_ID);

      const { data } = prismaMock.people.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.contacts).toBeUndefined();
      expect(data.addresses).toBeUndefined();
      expect(cityServiceMock.findOne).not.toHaveBeenCalled();
    });

    it("deve permitir um contato principal na lista quando não há telefone", async () => {
      await expect(
        peopleService.create(
          {
            ...dto,
            contacts: [
              { type: "MAIN", phone: "31999999999", isPrincipal: true },
            ],
          },
          COMPANY_ID,
        ),
      ).resolves.toBeDefined();
    });

    it("deve recusar contato principal na lista quando há telefone principal", async () => {
      await expect(
        peopleService.create(
          {
            ...dto,
            phone: "31999999999",
            contacts: [
              { type: "MAIN", phone: "3133334444", isPrincipal: true },
            ],
          },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.people.create).not.toHaveBeenCalled();
    });

    it("deve recusar mais de um contato principal ou mais de um endereço principal", async () => {
      await expect(
        peopleService.create(
          {
            ...dto,
            contacts: [
              { type: "MAIN", phone: "31999999999", isPrincipal: true },
              { type: "MESSAGE", phone: "3133334444", isPrincipal: true },
            ],
          },
          COMPANY_ID,
        ),
      ).rejects.toThrow("Informe no máximo um contato principal");

      await expect(
        peopleService.create(
          {
            ...dto,
            addresses: [
              { ...address, isPrincipal: true },
              { ...address, number: "200", isPrincipal: true },
            ],
          },
          COMPANY_ID,
        ),
      ).rejects.toThrow("Informe no máximo um endereço principal");
      expect(prismaMock.people.create).not.toHaveBeenCalled();
    });

    it("deve responder 404 para cidade inexistente, sem criar a pessoa", async () => {
      cityServiceMock.findOne.mockRejectedValueOnce(
        new NotFoundException("Cidade não encontrada"),
      );

      await expect(
        peopleService.create({ ...dto, addresses: [address] }, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.people.create).not.toHaveBeenCalled();
    });

    it("deve validar cada cidade distinta uma única vez", async () => {
      await peopleService.create(
        {
          ...dto,
          addresses: [
            address,
            { ...address, number: "200" },
            { ...address, number: "300", cityId: "city-2" },
          ],
        },
        COMPANY_ID,
      );

      expect(cityServiceMock.findOne).toHaveBeenCalledTimes(2);
      expect(cityServiceMock.findOne).toHaveBeenCalledWith("city-1");
      expect(cityServiceMock.findOne).toHaveBeenCalledWith("city-2");
    });

    it("deve manter o 409 de CPF repetido no cadastro completo", async () => {
      prismaMock.people.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(
        peopleService.create({ ...dto, phone: "31999999999" }, COMPANY_ID),
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

    it("deve listar ativas e inativas: não filtra por deletedAt", async () => {
      prismaMock.people.findMany.mockResolvedValue([
        { ...people, contacts: [] },
        { ...people, id: "2", deletedAt: new Date("2026-10-01"), contacts: [] },
      ]);
      prismaMock.people.count.mockResolvedValue(2);

      const result = await peopleService.findAll(
        { page: 1, limit: 10 },
        COMPANY_ID,
      );

      const { where } = prismaMock.people.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(where).not.toHaveProperty("deletedAt");
      expect(result.items.map((item) => item.deletedAt !== null)).toEqual([
        false,
        true,
      ]);
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

  describe("restore", () => {
    const inactive = { deletedAt: new Date("2026-10-01") };

    it("deve reativar a pessoa excluída limpando o deletedAt", async () => {
      prismaMock.people.findFirst.mockResolvedValue(inactive);
      prismaMock.people.update.mockResolvedValue({
        ...people,
        deletedAt: null,
      });

      await expect(peopleService.restore("1", COMPANY_ID)).resolves.toEqual({
        ...people,
        deletedAt: null,
      });
      expect(prismaMock.people.findFirst).toHaveBeenCalledWith({
        where: { id: "1", companyId: COMPANY_ID },
        select: { deletedAt: true },
      });
      expect(prismaMock.people.update).toHaveBeenCalledWith({
        where: { id: "1" },
        data: { deletedAt: null, updatedAt: anyDate },
        omit: { normalizedName: true },
      });
    });

    it("deve responder 404 para pessoa inexistente ou de outra empresa", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);

      await expect(
        peopleService.restore("1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.people.update).not.toHaveBeenCalled();
    });

    it("deve responder 409 quando a pessoa já está ativa", async () => {
      prismaMock.people.findFirst.mockResolvedValue({ deletedAt: null });

      await expect(peopleService.restore("1", COMPANY_ID)).rejects.toThrow(
        "A pessoa já está ativa",
      );
      expect(prismaMock.people.update).not.toHaveBeenCalled();
    });

    it("deve responder 409 quando o CPF já está em uso por outra pessoa ativa", async () => {
      prismaMock.people.findFirst.mockResolvedValue(inactive);
      prismaMock.people.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(peopleService.restore("1", COMPANY_ID)).rejects.toThrow(
        "Não é possível reativar: o CPF já está em uso por outra pessoa ativa",
      );
    });

    it("deve propagar outros erros sem mascará-los como conflito", async () => {
      prismaMock.people.findFirst.mockResolvedValue(inactive);
      prismaMock.people.update.mockRejectedValueOnce(new Error("conexão"));

      await expect(peopleService.restore("1", COMPANY_ID)).rejects.toThrow(
        "conexão",
      );
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
