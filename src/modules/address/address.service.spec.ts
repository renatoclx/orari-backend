import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID,
  OTHER_COMPANY_ID,
} from "../../../test/fixtures/authenticated-users";
import { PrismaService } from "../../prisma/prisma.service";
import { CityService } from "../city/city.service";
import { PeopleService } from "../people/people.service";
import { AddressService } from "./address.service";
import { CreateAddressDto } from "./dto/create-address.dto";

const anyDate: unknown = expect.any(Date);

const visibleToCompany = {
  OR: [
    { companyId: COMPANY_ID },
    { people: { companyId: COMPANY_ID, deletedAt: null } },
  ],
};

describe("AddressService", () => {
  let addressService: AddressService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    address: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };
  const cityServiceMock = { findOne: vi.fn() };
  const peopleServiceMock = { findOne: vi.fn() };

  const dto: CreateAddressDto = {
    type: "MAIN",
    cep: "30130000",
    street: "Avenida Afonso Pena",
    number: "100",
    cityId: "city-1",
    companyId: COMPANY_ID,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CityService, useValue: cityServiceMock },
        { provide: PeopleService, useValue: peopleServiceMock },
      ],
    }).compile();

    addressService = module.get<AddressService>(AddressService);
  });

  describe("create", () => {
    it("deve validar cidade e dono antes de criar o endereço", async () => {
      await addressService.create(dto, COMPANY_ID);

      expect(cityServiceMock.findOne).toHaveBeenCalledWith("city-1");
      expect(peopleServiceMock.findOne).not.toHaveBeenCalled();
      expect(prismaMock.address.create).toHaveBeenCalledWith({ data: dto });
    });

    it("não deve criar quando a cidade não existe", async () => {
      cityServiceMock.findOne.mockRejectedValueOnce(new NotFoundException());

      await expect(
        addressService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.address.create).not.toHaveBeenCalled();
    });

    it("deve recusar outra empresa como dona (404)", async () => {
      await expect(
        addressService.create(
          { ...dto, companyId: OTHER_COMPANY_ID },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.address.create).not.toHaveBeenCalled();
    });

    it("deve validar que a pessoa dona é da empresa do usuário", async () => {
      await addressService.create(
        { ...dto, companyId: undefined, peopleId: "people-1" },
        COMPANY_ID,
      );

      expect(peopleServiceMock.findOne).toHaveBeenCalledWith(
        "people-1",
        COMPANY_ID,
      );
    });
  });

  describe("findAll", () => {
    it("deve combinar o escopo da empresa com os filtros por dono", async () => {
      prismaMock.address.findMany.mockResolvedValue([]);
      prismaMock.address.count.mockResolvedValue(0);

      await addressService.findAll(
        { page: 1, limit: 10, companyId: COMPANY_ID },
        COMPANY_ID,
      );

      expect(prismaMock.address.count).toHaveBeenCalledWith({
        where: {
          ...visibleToCompany,
          deletedAt: null,
          companyId: COMPANY_ID,
          peopleId: undefined,
        },
      });
    });
  });

  describe("update", () => {
    it("deve validar a nova cidade quando cityId for informado", async () => {
      prismaMock.address.findFirst.mockResolvedValue({ id: "1" });

      await addressService.update("1", { cityId: "city-2" }, COMPANY_ID);

      expect(prismaMock.address.findFirst).toHaveBeenCalledWith({
        where: { id: "1", deletedAt: null, ...visibleToCompany },
      });
      expect(cityServiceMock.findOne).toHaveBeenCalledWith("city-2");
      expect(prismaMock.address.update).toHaveBeenCalledWith({
        where: { id: "1" },
        data: { cityId: "city-2", updatedAt: anyDate },
      });
    });

    it("não deve consultar cidade quando cityId não for informado", async () => {
      prismaMock.address.findFirst.mockResolvedValue({ id: "1" });

      await addressService.update("1", { number: "200" }, COMPANY_ID);

      expect(cityServiceMock.findOne).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("deve excluir logicamente o endereço", async () => {
      prismaMock.address.findFirst.mockResolvedValue({ id: "1" });

      await addressService.remove("1", COMPANY_ID);

      expect(prismaMock.address.update).toHaveBeenCalledWith({
        where: { id: "1" },
        data: { deletedAt: anyDate, updatedAt: anyDate },
      });
    });
  });
});
