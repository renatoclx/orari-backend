import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { PrismaService } from "../../prisma/prisma.service";
import { AppointmentService } from "../appointment/appointment.service";
import { CompanyService } from "../company/company.service";
import { PaymentService } from "../payment/payment.service";
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
    findOne: vi.fn(),
    rescheduleFromRecurrence: vi.fn(),
    cancelFromRecurrence: vi.fn(),
    createFromRecurrence: vi.fn(),
    cancelFutureFromRecurrence: vi.fn(),
  };
  const paymentServiceMock = {
    createPendingForAppointments: vi.fn(),
    cancelPendingForRecurrence: vi.fn(),
    moveDueDate: vi.fn(),
    cancelPendingForAppointment: vi.fn(),
    settlePendingForRecurrence: vi.fn(),
  };
  // Os testes de geração usam UTC para facilitar a leitura das datas.
  const companyServiceMock = { getTimeZone: vi.fn().mockResolvedValue("UTC") };

  // Horários gerados na chamada mais recente ao AppointmentService.
  const generatedOccurrences = () =>
    (
      appointmentServiceMock.createFromRecurrence.mock.calls.at(-1)?.[2] as
        { startAt: Date; endAt: Date }[] | undefined
    )?.map((occurrence) => occurrence.startAt.toISOString()) ?? [];

  // 60 dias após o início: o máximo permitido para uma recorrência avulsa.
  const endDate = new Date("2026-11-30");

  const dto: CreateRecurringAppointmentDto = {
    clientId: "client-1",
    professionalId: "professional-1",
    serviceId: "service-1",
    startDate: new Date("2026-10-01"),
    endDate,
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
    endDate,
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

  // Como o AppointmentService devolve os agendamentos criados.
  const createdAppointments = [
    { id: "appointment-1", startAt: new Date("2026-10-06T14:00:00.000Z") },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    peopleServiceMock.findOne.mockImplementation((id: string) =>
      id === "client-1" ? { id, type: "CLIENT" } : { id, type: "PROFESSIONAL" },
    );
    serviceServiceMock.findActive.mockResolvedValue({
      duration: 60,
      price: 100,
    });
    appointmentServiceMock.createFromRecurrence.mockResolvedValue(
      createdAppointments,
    );
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
        { provide: PaymentService, useValue: paymentServiceMock },
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
    it("deve gerar uma ocorrência por dia da semana até a data final", async () => {
      await recurringService.create(dto, COMPANY_ID);

      const occurrences = generatedOccurrences();
      // Terças a partir de 2026-10-06 (a de 2026-09-30 é quarta), até 2026-11-30.
      expect(occurrences[0]).toBe("2026-10-06T14:00:00.000Z");
      expect(occurrences[1]).toBe("2026-10-13T14:00:00.000Z");
      expect(occurrences.at(-1)).toBe("2026-11-24T14:00:00.000Z");
      expect(occurrences).toHaveLength(8);
    });

    it("deve gerar até a data final informada", async () => {
      const shortEnd = new Date("2026-10-20");

      await recurringService.create({ ...dto, endDate: shortEnd }, COMPANY_ID);

      expect(generatedOccurrences()).toEqual([
        "2026-10-06T14:00:00.000Z",
        "2026-10-13T14:00:00.000Z",
        "2026-10-20T14:00:00.000Z",
      ]);
    });

    it("não deve gerar ocorrências no passado", async () => {
      // Terças de setembro já passaram em 2026-09-30: a primeira gerada é 2026-10-06.
      await recurringService.create(
        {
          ...dto,
          startDate: new Date("2026-09-01"),
          endDate: new Date("2026-10-20"),
        },
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

  describe("pagamentos", () => {
    it("deve gerar um pagamento PENDING por agendamento, com o preço do serviço", async () => {
      await recurringService.create(dto, COMPANY_ID);

      expect(
        paymentServiceMock.createPendingForAppointments,
      ).toHaveBeenCalledWith(prismaMock, createdAppointments, 100, "UTC");
    });

    it("deve recusar serviço sem preço sem gravar nada", async () => {
      serviceServiceMock.findActive.mockResolvedValueOnce({
        duration: 60,
        price: null,
      });

      await expect(
        recurringService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.recurringAppointment.create).not.toHaveBeenCalled();
    });

    it("deve dar baixa em lote nos pendentes da recorrência", async () => {
      paymentServiceMock.settlePendingForRecurrence.mockResolvedValue(8);
      const settle = { paymentMethodId: "method-1" };

      const result = await recurringService.settlePayments(
        "recurring-1",
        settle,
        COMPANY_ID,
      );

      expect(result).toEqual({ settled: 8 });
      expect(
        paymentServiceMock.settlePendingForRecurrence,
      ).toHaveBeenCalledWith("recurring-1", settle, COMPANY_ID);
    });

    it("deve recusar baixa em lote de recorrência de outra empresa", async () => {
      prismaMock.recurringAppointment.findFirst.mockResolvedValueOnce(null);

      await expect(
        recurringService.settlePayments(
          "recurring-1",
          { paymentMethodId: "method-1" },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        paymentServiceMock.settlePendingForRecurrence,
      ).not.toHaveBeenCalled();
    });
  });

  describe("cancelamento", () => {
    it("deve cancelar os agendamentos futuros e depois os pagamentos pendentes", async () => {
      await recurringService.update(
        "recurring-1",
        { isActive: false },
        COMPANY_ID,
      );

      const cancelAppointments =
        appointmentServiceMock.cancelFutureFromRecurrence;
      const cancelPayments = paymentServiceMock.cancelPendingForRecurrence;
      expect(cancelAppointments).toHaveBeenCalledWith(
        prismaMock,
        "recurring-1",
        anyDate,
      );
      expect(cancelPayments).toHaveBeenCalledWith(
        prismaMock,
        "recurring-1",
        anyDate,
      );
      // Os pagamentos procuram os agendamentos já cancelados.
      expect(cancelAppointments.mock.invocationCallOrder[0]).toBeLessThan(
        cancelPayments.mock.invocationCallOrder[0],
      );
    });

    it("não deve repetir o cancelamento de uma recorrência já cancelada", async () => {
      prismaMock.recurringAppointment.findFirst.mockResolvedValueOnce({
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
      ).not.toHaveBeenCalled();
      expect(
        paymentServiceMock.cancelPendingForRecurrence,
      ).not.toHaveBeenCalled();
    });

    it("não deve mexer na agenda quando só a observação muda", async () => {
      await recurringService.update(
        "recurring-1",
        { note: "cliente pediu para manter" },
        COMPANY_ID,
      );

      expect(prismaMock.recurringAppointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { note: "cliente pediu para manter", updatedAt: anyDate },
        }),
      );
      expect(
        appointmentServiceMock.cancelFutureFromRecurrence,
      ).not.toHaveBeenCalled();
      expect(
        paymentServiceMock.cancelPendingForRecurrence,
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

    it("deve recusar período maior que 60 dias", async () => {
      // 2026-10-01 a 2026-12-01 são 61 dias.
      await expect(
        recurringService.create(
          { ...dto, endDate: new Date("2026-12-01") },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.recurringAppointment.create).not.toHaveBeenCalled();
    });

    it("deve aceitar período de exatamente 60 dias", async () => {
      await expect(
        recurringService.create(dto, COMPANY_ID),
      ).resolves.toBeDefined();
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

  describe("remanejamento e cancelamento de um agendamento", () => {
    // Período da recorrência: 2026-10-01 a 2026-11-30.
    const generated = {
      id: "appointment-1",
      recurringAppointmentId: "recurring-1",
      status: "SCHEDULED",
    };
    const reschedule = (startAt: string) =>
      recurringService.rescheduleAppointment(
        "recurring-1",
        "appointment-1",
        { startAt: new Date(startAt) },
        COMPANY_ID,
      );

    beforeEach(() => {
      appointmentServiceMock.findOne.mockResolvedValue(generated);
    });

    it("deve remarcar e mover o vencimento na mesma transação", async () => {
      const startAt = new Date("2026-10-08T10:00:00.000Z");

      await reschedule(startAt.toISOString());

      expect(
        appointmentServiceMock.rescheduleFromRecurrence,
      ).toHaveBeenCalledWith(prismaMock, generated, startAt);
      expect(paymentServiceMock.moveDueDate).toHaveBeenCalledWith(
        prismaMock,
        "appointment-1",
        startAt,
        "UTC",
      );
    });

    it("deve aceitar o último dia do período", async () => {
      await expect(
        reschedule("2026-11-30T10:00:00.000Z"),
      ).resolves.not.toThrow();
    });

    it.each(["2026-09-30T10:00:00.000Z", "2026-12-01T10:00:00.000Z"])(
      "deve recusar data fora do período (%s)",
      async (startAt) => {
        await expect(reschedule(startAt)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(
          appointmentServiceMock.rescheduleFromRecurrence,
        ).not.toHaveBeenCalled();
      },
    );

    it("deve considerar o dia no fuso da empresa", async () => {
      // 01:00 UTC de 01/12 ainda é 30/11 em São Paulo: dentro do período.
      companyServiceMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");

      await expect(
        reschedule("2026-12-01T01:00:00.000Z"),
      ).resolves.not.toThrow();
    });

    it("deve recusar agendamento de outra recorrência", async () => {
      appointmentServiceMock.findOne.mockResolvedValueOnce({
        ...generated,
        recurringAppointmentId: "recurring-2",
      });

      await expect(
        reschedule("2026-10-08T10:00:00.000Z"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("deve cancelar um agendamento e o pagamento dele na mesma transação", async () => {
      await recurringService.cancelAppointment(
        "recurring-1",
        "appointment-1",
        COMPANY_ID,
      );

      expect(appointmentServiceMock.cancelFromRecurrence).toHaveBeenCalledWith(
        prismaMock,
        generated,
      );
      expect(
        paymentServiceMock.cancelPendingForAppointment,
      ).toHaveBeenCalledWith(prismaMock, "appointment-1");
    });

    it("deve recusar cancelar agendamento de outra recorrência", async () => {
      appointmentServiceMock.findOne.mockResolvedValueOnce({
        ...generated,
        recurringAppointmentId: "recurring-2",
      });

      await expect(
        recurringService.cancelAppointment(
          "recurring-1",
          "appointment-1",
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        paymentServiceMock.cancelPendingForAppointment,
      ).not.toHaveBeenCalled();
    });

    it("deve recusar remanejamento em recorrência cancelada", async () => {
      prismaMock.recurringAppointment.findFirst.mockResolvedValueOnce({
        ...stored,
        isActive: false,
      });

      await expect(
        reschedule("2026-10-08T10:00:00.000Z"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("update", () => {
    it("deve lançar NotFoundException para recorrência de outra empresa", async () => {
      prismaMock.recurringAppointment.findFirst.mockResolvedValueOnce(null);

      await expect(
        recurringService.update("recurring-1", { isActive: false }, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
