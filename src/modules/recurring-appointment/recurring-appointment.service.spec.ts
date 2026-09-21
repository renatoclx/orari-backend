import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { PrismaService } from "../../prisma/prisma.service";
import { AppointmentService } from "../appointment/appointment.service";
import { CompanyService } from "../company/company.service";
import { PeopleService } from "../people/people.service";
import { ServiceService } from "../service/service.service";
import { CreateRecurringAppointmentDto } from "./dto/create-recurring-appointment.dto";
import { RecurringAppointmentService } from "./recurring-appointment.service";

const anyDate: unknown = expect.any(Date);

describe("RecurringAppointmentService", () => {
  let recurringService: RecurringAppointmentService;
  const prismaMock = {
    // Suporta as duas formas: lista de operações e transação interativa.
    $transaction: vi.fn(
      (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
        typeof arg === "function" ? arg(prismaMock) : Promise.all(arg),
    ),
    appointment: { aggregate: vi.fn() },
    recurringAppointment: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };
  const peopleServiceMock = { findOne: vi.fn() };
  const serviceServiceMock = { findActive: vi.fn() };
  const appointmentServiceMock = {
    createFromRecurrence: vi.fn(),
    cancelFutureFromRecurrence: vi.fn(),
  };
  // Os testes de geração usam UTC para facilitar a leitura das datas.
  const companyServiceMock = { getTimeZone: vi.fn().mockResolvedValue("UTC") };

  // Horários gerados na chamada mais recente ao AppointmentService.
  const generatedOccurrences = () =>
    (
      appointmentServiceMock.createFromRecurrence.mock.calls.at(-1)?.[2] as
        { startAt: Date; endAt: Date }[] | undefined
    )?.map((occurrence) => occurrence.startAt.toISOString()) ?? [];

  const dto: CreateRecurringAppointmentDto = {
    clientId: "client-1",
    professionalId: "professional-1",
    serviceId: "service-1",
    startDate: new Date("2026-10-01"),
    days: [{ weekDay: "TUESDAY", startTime: "14:00", endTime: "15:00" }],
  };

  // Como o banco devolve: horários são Date na data de referência 1970-01-01.
  const stored = {
    id: "recurring-1",
    companyId: COMPANY_ID,
    clientId: "client-1",
    professionalId: "professional-1",
    serviceId: "service-1",
    startDate: dto.startDate,
    endDate: null,
    note: null,
    isActive: true,
    createdAt: new Date("2026-09-17"),
    updatedAt: null,
    days: [
      {
        id: "day-1",
        recurringAppointmentId: "recurring-1",
        weekDay: "TUESDAY",
        startTime: new Date("1970-01-01T14:00:00.000Z"),
        endTime: new Date("1970-01-01T15:00:00.000Z"),
        createdAt: new Date("2026-09-17"),
        updatedAt: null,
      },
    ],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    peopleServiceMock.findOne.mockImplementation((id: string) =>
      id === "client-1" ? { id, type: "CLIENT" } : { id, type: "PROFESSIONAL" },
    );
    serviceServiceMock.findActive.mockResolvedValue({ duration: 60 });
    // Relógio fixo: as ocorrências geradas dependem de "hoje".
    vi.setSystemTime(new Date("2026-09-30T12:00:00.000Z"));
    prismaMock.recurringAppointment.create.mockResolvedValue(stored);
    prismaMock.recurringAppointment.update.mockResolvedValue(stored);
    prismaMock.recurringAppointment.findFirst.mockResolvedValue(stored);
    companyServiceMock.getTimeZone.mockResolvedValue("UTC");

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringAppointmentService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PeopleService, useValue: peopleServiceMock },
        { provide: ServiceService, useValue: serviceServiceMock },
        { provide: AppointmentService, useValue: appointmentServiceMock },
        { provide: CompanyService, useValue: companyServiceMock },
      ],
    }).compile();

    recurringService = module.get<RecurringAppointmentService>(
      RecurringAppointmentService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("geração de agendamentos", () => {
    it("deve gerar uma ocorrência por dia da semana, respeitando o horizonte de 90 dias", async () => {
      await recurringService.create(dto, COMPANY_ID);

      const occurrences = generatedOccurrences();
      // Terças a partir de 2026-10-06 (a de 2026-09-30 é quarta), até o horizonte.
      expect(occurrences[0]).toBe("2026-10-06T14:00:00.000Z");
      expect(occurrences[1]).toBe("2026-10-13T14:00:00.000Z");
      expect(occurrences).toHaveLength(13);
    });

    it("deve respeitar a data final quando ela é anterior ao horizonte", async () => {
      const endDate = new Date("2026-10-20");
      // O service usa a data final do registro criado, e não a do payload.
      prismaMock.recurringAppointment.create.mockResolvedValueOnce({
        ...stored,
        endDate,
      });

      await recurringService.create({ ...dto, endDate }, COMPANY_ID);

      expect(generatedOccurrences()).toEqual([
        "2026-10-06T14:00:00.000Z",
        "2026-10-13T14:00:00.000Z",
        "2026-10-20T14:00:00.000Z",
      ]);
    });

    it("não deve gerar ocorrências no passado", async () => {
      await recurringService.create(
        { ...dto, startDate: new Date("2026-01-01") },
        COMPANY_ID,
      );

      const occurrences = generatedOccurrences();
      expect(occurrences[0]).toBe("2026-10-06T14:00:00.000Z");
    });

    it("deve calcular o fim pela duração do serviço", async () => {
      await recurringService.create(dto, COMPANY_ID);

      const [{ startAt, endAt }] = appointmentServiceMock.createFromRecurrence
        .mock.calls[0][2] as { startAt: Date; endAt: Date }[];
      expect(endAt.getTime() - startAt.getTime()).toBe(60 * 60_000);
    });

    it("não deve gerar agendamentos para recorrência criada inativa", async () => {
      prismaMock.recurringAppointment.create.mockResolvedValueOnce({
        ...stored,
        isActive: false,
      });

      await recurringService.create({ ...dto, isActive: false }, COMPANY_ID);

      expect(
        appointmentServiceMock.createFromRecurrence,
      ).not.toHaveBeenCalled();
    });

    it("deve recusar dia que reserva menos tempo que a duração do serviço", async () => {
      await expect(
        recurringService.create(
          {
            ...dto,
            days: [
              { weekDay: "TUESDAY", startTime: "14:00", endTime: "14:30" },
            ],
          },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("fuso da empresa", () => {
    it("deve incluir o último dia quando a data final cai no fuso local", async () => {
      // endDate é data pura: em UTC-3 não pode ser deslocada para o dia anterior.
      companyServiceMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");
      const endDate = new Date("2026-10-20");
      prismaMock.recurringAppointment.create.mockResolvedValueOnce({
        ...stored,
        endDate,
      });

      await recurringService.create({ ...dto, endDate }, COMPANY_ID);

      // 2026-10-20 é uma terça: precisa ser a última ocorrência gerada.
      expect(generatedOccurrences().at(-1)).toBe("2026-10-20T17:00:00.000Z");
    });

    it("deve gerar os horários no relógio da empresa", async () => {
      // 14:00 em São Paulo (UTC-3) equivale a 17:00 UTC.
      companyServiceMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");

      await recurringService.create(dto, COMPANY_ID);

      expect(generatedOccurrences()[0]).toBe("2026-10-06T17:00:00.000Z");
    });
  });

  describe("extend", () => {
    beforeEach(() => {
      prismaMock.appointment.aggregate.mockResolvedValue({
        _max: { startAt: new Date("2026-12-29T14:00:00.000Z") },
      });
      appointmentServiceMock.createFromRecurrence.mockResolvedValue(5);
    });

    it("deve continuar a partir do último agendamento gerado", async () => {
      const { created } = await recurringService.extend(
        "recurring-1",
        COMPANY_ID,
      );

      expect(created).toBe(5);
      // O bloco novo começa depois do último gerado (2026-12-29, terça), e não
      // de hoje: a próxima terça é 2027-01-05.
      expect(generatedOccurrences()[0]).toBe("2027-01-05T14:00:00.000Z");
    });

    it("deve recusar extensão de recorrência inativa", async () => {
      prismaMock.recurringAppointment.findFirst.mockResolvedValueOnce({
        ...stored,
        isActive: false,
      });

      await expect(
        recurringService.extend("recurring-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("deve recusar quando não há mais horários a gerar", async () => {
      prismaMock.recurringAppointment.findFirst.mockResolvedValueOnce({
        ...stored,
        endDate: new Date("2026-10-10"),
      });
      prismaMock.appointment.aggregate.mockResolvedValue({
        _max: { startAt: new Date("2026-10-06T14:00:00.000Z") },
      });

      await expect(
        recurringService.extend("recurring-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("findNeedingExtension", () => {
    it("deve apontar recorrência cujo horizonte está acabando", async () => {
      prismaMock.recurringAppointment.findMany.mockResolvedValue([
        {
          id: "recurring-1",
          endDate: null,
          // Dentro dos 30 dias de aviso a partir de 2026-09-30.
          appointments: [{ startAt: new Date("2026-10-10T14:00:00.000Z") }],
        },
      ]);

      await expect(
        recurringService.findNeedingExtension(COMPANY_ID),
      ).resolves.toEqual([
        {
          id: "recurring-1",
          generatedUntil: new Date("2026-10-10T14:00:00.000Z"),
        },
      ]);
    });

    it("não deve apontar recorrência com horizonte folgado", async () => {
      prismaMock.recurringAppointment.findMany.mockResolvedValue([
        {
          id: "recurring-1",
          endDate: null,
          appointments: [{ startAt: new Date("2026-12-20T14:00:00.000Z") }],
        },
      ]);

      await expect(
        recurringService.findNeedingExtension(COMPANY_ID),
      ).resolves.toEqual([]);
    });

    it("não deve apontar recorrência que já gerou até a data final", async () => {
      prismaMock.recurringAppointment.findMany.mockResolvedValue([
        {
          id: "recurring-1",
          endDate: new Date("2026-10-10"),
          appointments: [{ startAt: new Date("2026-10-10T14:00:00.000Z") }],
        },
      ]);

      await expect(
        recurringService.findNeedingExtension(COMPANY_ID),
      ).resolves.toEqual([]);
    });
  });

  describe("regeração ao editar", () => {
    it("deve cancelar os futuros e regerar quando os dias mudam", async () => {
      await recurringService.update(
        "recurring-1",
        { days: [{ weekDay: "MONDAY", startTime: "08:00", endTime: "09:30" }] },
        COMPANY_ID,
      );

      expect(
        appointmentServiceMock.cancelFutureFromRecurrence,
      ).toHaveBeenCalledWith(prismaMock, "recurring-1", anyDate);
      expect(appointmentServiceMock.createFromRecurrence).toHaveBeenCalled();
    });

    it("deve apenas cancelar os futuros ao desativar", async () => {
      prismaMock.recurringAppointment.update.mockResolvedValueOnce({
        ...stored,
        isActive: false,
      });

      await recurringService.update(
        "recurring-1",
        { isActive: false },
        COMPANY_ID,
      );

      expect(
        appointmentServiceMock.cancelFutureFromRecurrence,
      ).toHaveBeenCalled();
      expect(
        appointmentServiceMock.createFromRecurrence,
      ).not.toHaveBeenCalled();
    });

    it("não deve mexer na agenda quando só a observação muda", async () => {
      await recurringService.update(
        "recurring-1",
        { note: "cliente pediu para manter" },
        COMPANY_ID,
      );

      expect(
        appointmentServiceMock.cancelFutureFromRecurrence,
      ).not.toHaveBeenCalled();
      expect(
        appointmentServiceMock.createFromRecurrence,
      ).not.toHaveBeenCalled();
    });
  });

  describe("create", () => {
    it("deve gravar os dias convertendo os horários e devolvê-los em HH:MM", async () => {
      const result = await recurringService.create(dto, COMPANY_ID);

      expect(prismaMock.recurringAppointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: COMPANY_ID,
            days: {
              create: [
                {
                  weekDay: "TUESDAY",
                  startTime: new Date("1970-01-01T14:00:00.000Z"),
                  endTime: new Date("1970-01-01T15:00:00.000Z"),
                },
              ],
            },
          }) as unknown,
        }),
      );
      expect(result.days).toEqual([
        { weekDay: "TUESDAY", startTime: "14:00", endTime: "15:00" },
      ]);
    });

    it("deve recusar dia com fim anterior ao início", async () => {
      await expect(
        recurringService.create(
          {
            ...dto,
            days: [
              { weekDay: "TUESDAY", startTime: "15:00", endTime: "14:00" },
            ],
          },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("deve recusar horários sobrepostos no mesmo dia da semana", async () => {
      await expect(
        recurringService.create(
          {
            ...dto,
            days: [
              { weekDay: "TUESDAY", startTime: "14:00", endTime: "15:00" },
              { weekDay: "TUESDAY", startTime: "14:30", endTime: "16:00" },
            ],
          },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("deve aceitar horários encostados no mesmo dia e dias diferentes", async () => {
      await expect(
        recurringService.create(
          {
            ...dto,
            days: [
              { weekDay: "TUESDAY", startTime: "14:00", endTime: "15:00" },
              { weekDay: "TUESDAY", startTime: "15:00", endTime: "16:00" },
              { weekDay: "FRIDAY", startTime: "14:30", endTime: "15:30" },
            ],
          },
          COMPANY_ID,
        ),
      ).resolves.toBeDefined();
    });

    it("deve recusar endDate anterior a startDate", async () => {
      await expect(
        recurringService.create(
          { ...dto, endDate: new Date("2026-09-01") },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("deve recusar serviço inativo ou de outra empresa", async () => {
      serviceServiceMock.findActive.mockRejectedValueOnce(
        new NotFoundException(),
      );

      await expect(
        recurringService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.recurringAppointment.create).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("deve substituir todos os dias quando a lista é informada", async () => {
      await recurringService.update(
        "recurring-1",
        { days: [{ weekDay: "MONDAY", startTime: "08:00", endTime: "09:00" }] },
        COMPANY_ID,
      );

      expect(prismaMock.recurringAppointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "recurring-1" },
          data: {
            updatedAt: anyDate,
            days: {
              deleteMany: {},
              create: [
                {
                  weekDay: "MONDAY",
                  startTime: new Date("1970-01-01T08:00:00.000Z"),
                  endTime: new Date("1970-01-01T09:00:00.000Z"),
                },
              ],
            },
          },
        }),
      );
    });

    it("não deve tocar nos dias quando a lista não é informada", async () => {
      await recurringService.update(
        "recurring-1",
        { isActive: false },
        COMPANY_ID,
      );

      expect(prismaMock.recurringAppointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isActive: false, updatedAt: anyDate },
        }),
      );
    });

    it("deve lançar NotFoundException para recorrência de outra empresa", async () => {
      prismaMock.recurringAppointment.findFirst.mockResolvedValueOnce(null);

      await expect(
        recurringService.update("recurring-1", { isActive: false }, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
