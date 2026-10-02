import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { BusinessHourService } from "./business-hour.service";

const time = (value: string) => new Date(`1970-01-01T${value}:00.000Z`);

describe("BusinessHourService", () => {
  let businessHourService: BusinessHourService;
  const prismaMock = {
    // Suporta as duas formas: lista de operações e transação interativa.
    $transaction: vi.fn(
      (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
        typeof arg === "function" ? arg(prismaMock) : Promise.all(arg),
    ),
    businessHour: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };

  const companyServiceMock = { getTimeZone: vi.fn() };

  const stored = {
    id: "hour-1",
    companyId: COMPANY_ID,
    weekDay: "TUESDAY",
    openAt: time("09:00"),
    closeAt: time("18:00"),
    createdAt: new Date(),
    updatedAt: null,
    deletedAt: null,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.businessHour.create.mockResolvedValue(stored);
    prismaMock.businessHour.update.mockResolvedValue(stored);
    // Por padrão os testes usam UTC; o caso do fuso é explícito abaixo.
    companyServiceMock.getTimeZone.mockResolvedValue("UTC");

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessHourService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CompanyService, useValue: companyServiceMock },
      ],
    }).compile();

    businessHourService = module.get<BusinessHourService>(BusinessHourService);
  });

  describe("create", () => {
    const dto = {
      weekDay: "TUESDAY" as const,
      openAt: "09:00",
      closeAt: "18:00",
    };

    it("deve gravar os horários convertidos e devolvê-los em HH:MM", async () => {
      const result = await businessHourService.create(dto, COMPANY_ID);

      expect(prismaMock.businessHour.create).toHaveBeenCalledWith({
        data: {
          weekDay: "TUESDAY",
          openAt: time("09:00"),
          closeAt: time("18:00"),
          companyId: COMPANY_ID,
        },
      });
      expect(result.openAt).toBe("09:00");
      expect(result.closeAt).toBe("18:00");
    });

    it("deve recusar fechamento anterior à abertura", async () => {
      await expect(
        businessHourService.create(
          { ...dto, openAt: "18:00", closeAt: "09:00" },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("deve recusar janela sobreposta no mesmo dia", async () => {
      prismaMock.businessHour.findFirst.mockResolvedValueOnce({ id: "hour-0" });

      await expect(
        businessHourService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.businessHour.create).not.toHaveBeenCalled();
    });
  });

  describe("createMany", () => {
    const monday = {
      weekDay: "MONDAY" as const,
      openAt: "09:00",
      closeAt: "12:00",
    };
    const tuesday = {
      weekDay: "TUESDAY" as const,
      openAt: "09:00",
      closeAt: "12:00",
    };

    it("deve criar todos os itens do lote numa única transação", async () => {
      prismaMock.businessHour.findFirst.mockResolvedValue(null);
      prismaMock.businessHour.create
        .mockResolvedValueOnce({ ...stored, weekDay: "MONDAY" })
        .mockResolvedValueOnce({ ...stored, weekDay: "TUESDAY" });

      const result = await businessHourService.createMany(
        [monday, tuesday],
        COMPANY_ID,
      );

      expect(prismaMock.businessHour.create).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
      expect(result.map((item) => item.weekDay)).toEqual(["MONDAY", "TUESDAY"]);
    });

    it("deve recusar o lote inteiro se um item tiver fechamento antes da abertura", async () => {
      await expect(
        businessHourService.createMany(
          [monday, { ...tuesday, openAt: "18:00", closeAt: "09:00" }],
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.businessHour.create).not.toHaveBeenCalled();
    });

    it("deve recusar quando dois itens do mesmo lote se sobrepõem", async () => {
      await expect(
        businessHourService.createMany(
          [monday, { ...monday, openAt: "11:00", closeAt: "14:00" }],
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.businessHour.create).not.toHaveBeenCalled();
    });

    it("deve aceitar itens do mesmo lote que apenas se encostam", async () => {
      prismaMock.businessHour.findFirst.mockResolvedValue(null);
      prismaMock.businessHour.create.mockResolvedValue(stored);

      await expect(
        businessHourService.createMany(
          [monday, { ...monday, openAt: "12:00", closeAt: "15:00" }],
          COMPANY_ID,
        ),
      ).resolves.toHaveLength(2);
    });

    it("deve recusar o lote quando um item conflita com uma janela já existente", async () => {
      prismaMock.businessHour.findFirst
        .mockResolvedValueOnce(null) // monday: livre
        .mockResolvedValueOnce({ id: "hour-0" }); // tuesday: conflita
      prismaMock.businessHour.create.mockResolvedValueOnce(stored);

      await expect(
        businessHourService.createMany([monday, tuesday], COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      // O monday já tinha sido criado dentro da transação; o teste só confirma
      // que a função rejeita — a própria transação é quem desfaz no Postgres
      // de verdade (o mock aqui não simula rollback).
      expect(prismaMock.businessHour.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("ensureWithinBusinessHours", () => {
    // 2026-10-06 é uma terça-feira.
    const terca = (time: string) => new Date(`2026-10-06T${time}:00.000Z`);

    it("não deve restringir quando a empresa não cadastrou nenhuma janela", async () => {
      prismaMock.businessHour.count.mockResolvedValue(0);

      await expect(
        businessHourService.ensureWithinBusinessHours(
          COMPANY_ID,
          terca("03:00"),
          terca("03:30"),
        ),
      ).resolves.toBeUndefined();
      expect(prismaMock.businessHour.findMany).not.toHaveBeenCalled();
    });

    it("deve aceitar intervalo dentro da janela do dia", async () => {
      prismaMock.businessHour.count.mockResolvedValue(1);
      prismaMock.businessHour.findMany.mockResolvedValue([
        { openAt: time("09:00"), closeAt: time("18:00") },
      ]);

      await expect(
        businessHourService.ensureWithinBusinessHours(
          COMPANY_ID,
          terca("14:00"),
          terca("14:30"),
        ),
      ).resolves.toBeUndefined();
      expect(prismaMock.businessHour.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: COMPANY_ID, deletedAt: null, weekDay: "TUESDAY" },
        }),
      );
    });

    it.each([
      ["antes da abertura", "08:00", "08:30"],
      ["depois do fechamento", "18:00", "18:30"],
      ["atravessando o fechamento", "17:45", "18:15"],
    ])("deve recusar intervalo %s", async (_caso, inicio, fim) => {
      prismaMock.businessHour.count.mockResolvedValue(1);
      prismaMock.businessHour.findMany.mockResolvedValue([
        { openAt: time("09:00"), closeAt: time("18:00") },
      ]);

      await expect(
        businessHourService.ensureWithinBusinessHours(
          COMPANY_ID,
          terca(inicio),
          terca(fim),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("deve comparar no fuso da empresa, não em UTC", async () => {
      // 12:00 UTC = 09:00 em São Paulo: dentro da janela 09:00-18:00.
      companyServiceMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");
      prismaMock.businessHour.count.mockResolvedValue(1);
      prismaMock.businessHour.findMany.mockResolvedValue([
        { openAt: time("09:00"), closeAt: time("18:00") },
      ]);

      await expect(
        businessHourService.ensureWithinBusinessHours(
          COMPANY_ID,
          terca("12:00"),
          terca("13:00"),
        ),
      ).resolves.toBeUndefined();

      // 08:00 UTC = 05:00 em São Paulo: fora da janela.
      await expect(
        businessHourService.ensureWithinBusinessHours(
          COMPANY_ID,
          terca("08:00"),
          terca("09:00"),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("deve usar o dia da semana do fuso da empresa", async () => {
      // 2026-10-07 00:30 UTC ainda é terça-feira (21:30) em São Paulo.
      companyServiceMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");
      prismaMock.businessHour.count.mockResolvedValue(1);
      prismaMock.businessHour.findMany.mockResolvedValue([
        { openAt: time("21:00"), closeAt: time("23:00") },
      ]);

      await businessHourService.ensureWithinBusinessHours(
        COMPANY_ID,
        new Date("2026-10-07T00:30:00.000Z"),
        new Date("2026-10-07T01:00:00.000Z"),
      );

      expect(prismaMock.businessHour.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ weekDay: "TUESDAY" }) as unknown,
        }),
      );
    });

    it("deve recusar dia sem janela cadastrada", async () => {
      prismaMock.businessHour.count.mockResolvedValue(3);
      prismaMock.businessHour.findMany.mockResolvedValue([]);

      await expect(
        businessHourService.ensureWithinBusinessHours(
          COMPANY_ID,
          terca("14:00"),
          terca("14:30"),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("deve aceitar quando uma das janelas do dia comporta o intervalo", async () => {
      prismaMock.businessHour.count.mockResolvedValue(2);
      prismaMock.businessHour.findMany.mockResolvedValue([
        { openAt: time("09:00"), closeAt: time("12:00") },
        { openAt: time("13:00"), closeAt: time("18:00") },
      ]);

      await expect(
        businessHourService.ensureWithinBusinessHours(
          COMPANY_ID,
          terca("13:30"),
          terca("14:00"),
        ),
      ).resolves.toBeUndefined();
    });

    it("deve recusar intervalo que cai no vão entre duas janelas", async () => {
      prismaMock.businessHour.count.mockResolvedValue(2);
      prismaMock.businessHour.findMany.mockResolvedValue([
        { openAt: time("09:00"), closeAt: time("12:00") },
        { openAt: time("13:00"), closeAt: time("18:00") },
      ]);

      await expect(
        businessHourService.ensureWithinBusinessHours(
          COMPANY_ID,
          terca("12:15"),
          terca("12:45"),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("findOne", () => {
    it("deve lançar NotFoundException para janela de outra empresa", async () => {
      prismaMock.businessHour.findFirst.mockResolvedValue(null);

      await expect(
        businessHourService.findOne("hour-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
