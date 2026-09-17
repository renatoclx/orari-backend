import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID,
  OTHER_COMPANY_ID,
} from "../../../test/fixtures/authenticated-users";
import { PrismaService } from "../../prisma/prisma.service";
import { PeopleService } from "../people/people.service";
import { ContactService } from "./contact.service";
import { CreateContactDto } from "./dto/create-contact.dto";

const anyDate: unknown = expect.any(Date);

// Filtro esperado de "visível para a empresa" (ver ownedByCompany).
const visibleToCompany = {
  OR: [
    { companyId: COMPANY_ID },
    { people: { companyId: COMPANY_ID, deletedAt: null } },
  ],
};

describe("ContactService", () => {
  let contactService: ContactService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    contact: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };
  const peopleServiceMock = { findOne: vi.fn() };

  const baseDto = {
    type: "MAIN",
    phone: "31999999999",
    email: "contato@orari.com",
  } as const;
  const stored = { id: "1", phone: "31999999999", email: "contato@orari.com" };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PeopleService, useValue: peopleServiceMock },
      ],
    }).compile();

    contactService = module.get<ContactService>(ContactService);
  });

  describe("create", () => {
    it("deve aceitar a própria empresa como dona", async () => {
      const dto: CreateContactDto = { ...baseDto, companyId: COMPANY_ID };

      await contactService.create(dto, COMPANY_ID);

      expect(peopleServiceMock.findOne).not.toHaveBeenCalled();
      expect(prismaMock.contact.create).toHaveBeenCalledWith({ data: dto });
    });

    it("deve recusar outra empresa como dona (404)", async () => {
      await expect(
        contactService.create(
          { ...baseDto, companyId: OTHER_COMPANY_ID },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.contact.create).not.toHaveBeenCalled();
    });

    it("deve validar que a pessoa dona é da empresa do usuário", async () => {
      await contactService.create(
        { ...baseDto, peopleId: "people-1" },
        COMPANY_ID,
      );

      expect(peopleServiceMock.findOne).toHaveBeenCalledWith(
        "people-1",
        COMPANY_ID,
      );
    });

    it("não deve criar quando a pessoa não pertence à empresa", async () => {
      peopleServiceMock.findOne.mockRejectedValueOnce(new NotFoundException());

      await expect(
        contactService.create({ ...baseDto, peopleId: "people-1" }, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.contact.create).not.toHaveBeenCalled();
    });
  });

  describe("findAll", () => {
    it("deve combinar o escopo da empresa com os filtros por dono", async () => {
      prismaMock.contact.findMany.mockResolvedValue([]);
      prismaMock.contact.count.mockResolvedValue(0);

      await contactService.findAll(
        { page: 1, limit: 10, peopleId: "people-1" },
        COMPANY_ID,
      );

      expect(prismaMock.contact.count).toHaveBeenCalledWith({
        where: {
          ...visibleToCompany,
          deletedAt: null,
          companyId: undefined,
          peopleId: "people-1",
        },
      });
    });
  });

  describe("findOne", () => {
    it("deve buscar apenas contatos visíveis para a empresa", async () => {
      prismaMock.contact.findFirst.mockResolvedValue(null);

      await expect(
        contactService.findOne("1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.contact.findFirst).toHaveBeenCalledWith({
        where: { id: "1", deletedAt: null, ...visibleToCompany },
      });
    });
  });

  describe("update", () => {
    it("deve atualizar o contato registrando o updatedAt", async () => {
      prismaMock.contact.findFirst.mockResolvedValue(stored);

      await contactService.update("1", { email: "novo@orari.com" }, COMPANY_ID);

      expect(prismaMock.contact.update).toHaveBeenCalledWith({
        where: { id: "1" },
        data: { email: "novo@orari.com", updatedAt: anyDate },
      });
    });

    it("deve permitir limpar um campo quando o outro permanece", async () => {
      prismaMock.contact.findFirst.mockResolvedValue(stored);

      await contactService.update(
        "1",
        { phone: null as unknown as string },
        COMPANY_ID,
      );

      expect(prismaMock.contact.update).toHaveBeenCalled();
    });

    it("não deve permitir que o contato fique sem telefone e sem e-mail", async () => {
      prismaMock.contact.findFirst.mockResolvedValue({
        ...stored,
        email: null,
      });

      await expect(
        contactService.update(
          "1",
          { phone: null as unknown as string },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.contact.update).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("deve lançar NotFoundException para contato fora da empresa", async () => {
      prismaMock.contact.findFirst.mockResolvedValue(null);

      await expect(
        contactService.remove("1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.contact.update).not.toHaveBeenCalled();
    });

    it("deve excluir logicamente o contato", async () => {
      prismaMock.contact.findFirst.mockResolvedValue(stored);

      await contactService.remove("1", COMPANY_ID);

      expect(prismaMock.contact.update).toHaveBeenCalledWith({
        where: { id: "1" },
        data: { deletedAt: anyDate, updatedAt: anyDate },
      });
    });
  });
});
