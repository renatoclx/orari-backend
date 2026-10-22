import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
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
      updateMany: vi.fn(),
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

  // Período de dois meses (não há mais limite de duração).
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
    clientPlanId: null,
    createdAt: new Date("2026-09-17"),
    updatedAt: null,
    client: { id: "client-1", name: "Ana Paula", photoUrl: null },
    professional: { id: "professional-1", name: "Carla", photoUrl: null },
    service: {
      id: "service-1",
      name: "Pilates",
      color: "#FF8800",
      duration: 60,
    },
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

    it("não deve gerar ocorrência antes da data de início quando já é noite no fuso da empresa", async () => {
      // 22:00 de quarta (21/10) em São Paulo já é 01:00Z de quinta (22/10): a data
      // pura de início (22/10 à meia-noite UTC) não pode ser lida como "já começou".
      vi.setSystemTime(new Date("2026-10-22T01:00:00.000Z"));
      companyServiceMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");
      const startDate = new Date("2026-10-22");
      const endDate = new Date("2026-10-29");
      prismaMock.recurringAppointment.create.mockResolvedValueOnce({
        ...stored,
        startDate,
        endDate,
      });

      await recurringService.create(
        {
          ...dto,
          startDate,
          endDate,
          days: [
            { weekDay: "WEDNESDAY", startTime: "22:30", endTime: "23:30" },
            { weekDay: "THURSDAY", startTime: "10:00", endTime: "11:00" },
          ],
        },
        COMPANY_ID,
      );

      // Quarta 21/10 às 22:30 local (01:30Z) ainda está no futuro, mas é anterior
      // ao início e não entra. A primeira é a quinta 22/10 às 10:00 local.
      expect(generatedOccurrences()).toEqual([
        "2026-10-22T13:00:00.000Z",
        "2026-10-29T01:30:00.000Z",
        "2026-10-29T13:00:00.000Z",
      ]);
    });

    it("deve começar hoje, e não na data de início, quando ela já passou", async () => {
      // Início em 01/10 (passado): gera a partir de hoje (30/09 12:00Z, em UTC).
      const startDate = new Date("2026-09-01");
      const endDate = new Date("2026-10-07");
      prismaMock.recurringAppointment.create.mockResolvedValueOnce({
        ...stored,
        startDate,
        endDate,
      });

      await recurringService.create({ ...dto, startDate, endDate }, COMPANY_ID);

      expect(generatedOccurrences()[0]).toBe("2026-10-06T14:00:00.000Z");
    });

    it("deve gerar os horários no relógio da empresa", async () => {
      // 14:00 em São Paulo (UTC-3) equivale a 17:00 UTC.
      companyServiceMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");

      await recurringService.create(dto, COMPANY_ID);

      expect(generatedOccurrences()[0]).toBe("2026-10-06T17:00:00.000Z");
    });
  });

  describe("dados relacionados nas respostas", () => {
    // O que a tela precisa, e nada além disso (sem documento nem contatos).
    const expectedInclude = {
      days: { orderBy: { startTime: "asc" } },
      client: { select: { id: true, name: true, photoUrl: true } },
      professional: { select: { id: true, name: true, photoUrl: true } },
      service: {
        select: { id: true, name: true, color: true, duration: true },
      },
    };

    it("deve devolver cliente, profissional e serviço junto com os ids planos", async () => {
      const result = await recurringService.create(dto, COMPANY_ID);

      expect(result).toMatchObject({
        clientId: "client-1",
        professionalId: "professional-1",
        serviceId: "service-1",
        clientPlanId: null,
        client: { id: "client-1", name: "Ana Paula", photoUrl: null },
        professional: { id: "professional-1", name: "Carla", photoUrl: null },
        service: {
          id: "service-1",
          name: "Pilates",
          color: "#FF8800",
          duration: 60,
        },
      });
    });

    it("deve ordenar a listagem por início e desempatar pelo id (paginação estável)", async () => {
      prismaMock.recurringAppointment.findMany.mockResolvedValue([stored]);
      prismaMock.recurringAppointment.count.mockResolvedValue(1);

      await recurringService.findAll({ page: 1, limit: 10 }, COMPANY_ID);

      expect(prismaMock.recurringAppointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ startDate: "asc" }, { id: "asc" }],
        }),
      );
    });

    it("deve pedir as relações no create, no detalhe, na listagem e na edição", async () => {
      prismaMock.recurringAppointment.findMany.mockResolvedValue([stored]);
      prismaMock.recurringAppointment.count.mockResolvedValue(1);

      await recurringService.create(dto, COMPANY_ID);
      await recurringService.findOne("recurring-1", COMPANY_ID);
      await recurringService.findAll({ page: 1, limit: 10 }, COMPANY_ID);
      await recurringService.update(
        "recurring-1",
        { note: "ajuste" },
        COMPANY_ID,
      );

      for (const call of [
        prismaMock.recurringAppointment.create,
        prismaMock.recurringAppointment.findFirst,
        prismaMock.recurringAppointment.findMany,
        prismaMock.recurringAppointment.update,
      ]) {
        expect(call).toHaveBeenCalledWith(
          expect.objectContaining({ include: expectedInclude }),
        );
      }
    });

    it("deve informar o clientPlanId quando a recorrência é de um pacote", async () => {
      prismaMock.recurringAppointment.findFirst.mockResolvedValue({
        ...stored,
        clientPlanId: "client-plan-1",
      });

      await expect(
        recurringService.findOne("recurring-1", COMPANY_ID),
      ).resolves.toMatchObject({ clientPlanId: "client-plan-1" });
    });
  });

  describe("mensagem de conflito com a data", () => {
    it("deve repassar o fuso da empresa para a mensagem de conflito da criação", async () => {
      companyServiceMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");

      await recurringService.create(dto, COMPANY_ID);

      // (tx, dados, ocorrências, fuso, observação)
      expect(appointmentServiceMock.createFromRecurrence).toHaveBeenCalledWith(
        prismaMock,
        expect.anything(),
        expect.any(Array),
        "America/Sao_Paulo",
        null,
      );
    });

    it("deve manter o erro de conflito do AppointmentService sem alterá-lo", async () => {
      appointmentServiceMock.createFromRecurrence.mockRejectedValueOnce(
        new ConflictException(
          "Conflito em 06/10/2026 às 11:00: O profissional já possui um agendamento neste horário",
        ),
      );

      await expect(recurringService.create(dto, COMPANY_ID)).rejects.toThrow(
        "Conflito em 06/10/2026 às 11:00:",
      );
      expect(
        paymentServiceMock.createPendingForAppointments,
      ).not.toHaveBeenCalled();
    });
  });

  describe("pagamentos", () => {
    it("deve gerar um pagamento PENDING por agendamento, com o preço do serviço", async () => {
      await recurringService.create(dto, COMPANY_ID);

      expect(
        paymentServiceMock.createPendingForAppointments,
      ).toHaveBeenCalledWith(
        prismaMock,
        COMPANY_ID,
        createdAppointments,
        100,
        "UTC",
      );
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

    it("deve aceitar período de um ano: não há mais limite de 60 dias", async () => {
      // 2026-10-01 a 2027-09-30, toda terça.
      await expect(
        recurringService.create(
          { ...dto, endDate: new Date("2027-09-30") },
          COMPANY_ID,
        ),
      ).resolves.toBeDefined();
      expect(generatedOccurrences()).toHaveLength(52);
      expect(generatedOccurrences().at(-1)).toBe("2027-09-28T14:00:00.000Z");
    });

    it("deve usar o tempo maior de transação, por gerar muitos agendamentos", async () => {
      await recurringService.create(dto, COMPANY_ID);

      expect(prismaMock.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { timeout: 30_000 },
      );
    });

    it("deve aceitar início e fim no mesmo dia", async () => {
      await expect(
        recurringService.create(
          { ...dto, startDate: endDate, endDate },
          COMPANY_ID,
        ),
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
      ).toHaveBeenCalledWith(prismaMock, generated, startAt, {
        allowNoShow: false,
      });
      expect(paymentServiceMock.moveDueDate).toHaveBeenCalledWith(
        prismaMock,
        "appointment-1",
        startAt,
        "UTC",
      );
    });

    it("sessão de pacote: autoriza a reposição após falta (NO_SHOW)", async () => {
      prismaMock.recurringAppointment.findFirst.mockResolvedValue({
        ...stored,
        clientPlanId: "client-plan-1",
      });
      const startAt = new Date("2026-10-08T10:00:00.000Z");

      await reschedule(startAt.toISOString());

      expect(
        appointmentServiceMock.rescheduleFromRecurrence,
      ).toHaveBeenCalledWith(prismaMock, generated, startAt, {
        allowNoShow: true,
      });
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

    it("recorrência antiga sem data final: só o início limita o remanejamento", async () => {
      prismaMock.recurringAppointment.findFirst.mockResolvedValue({
        ...stored,
        endDate: null,
      });

      await expect(
        reschedule("2027-06-15T10:00:00.000Z"),
      ).resolves.not.toThrow();
      await expect(
        reschedule("2026-09-30T10:00:00.000Z"),
      ).rejects.toBeInstanceOf(BadRequestException);
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

  describe("agenda de plano contratado", () => {
    // Um ano inteiro: bem além do limite de 60 dias da recorrência avulsa.
    const schedule = {
      clientPlanId: "client-plan-1",
      clientId: "client-1",
      professionalId: "professional-1",
      serviceId: "service-1",
      startDate: new Date("2026-10-01"),
      endDate: new Date("2027-09-30"),
      days: [
        { weekDay: "TUESDAY" as const, startTime: "14:00", endTime: "15:00" },
      ],
    };
    // A transação vem da contratação; aqui basta um objeto com as mesmas tabelas.
    const tx = prismaMock as never;

    it("deve gravar o vínculo com a contratação e gerar o período inteiro", async () => {
      await recurringService.createForClientPlan(
        tx,
        schedule,
        COMPANY_ID,
        "UTC",
      );

      expect(prismaMock.recurringAppointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clientPlanId: "client-plan-1",
            companyId: COMPANY_ID,
            endDate: schedule.endDate,
          }) as unknown,
        }),
      );
      // Terças de 2026-10-06 a 2027-09-28: 52 semanas.
      expect(generatedOccurrences()).toHaveLength(52);
      expect(generatedOccurrences().at(-1)).toBe("2027-09-28T14:00:00.000Z");
    });

    it("não deve gerar pagamento por agendamento nem abrir transação própria", async () => {
      await recurringService.createForClientPlan(
        tx,
        schedule,
        COMPANY_ID,
        "UTC",
      );

      expect(
        paymentServiceMock.createPendingForAppointments,
      ).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("não deve exigir preço do serviço", async () => {
      serviceServiceMock.findActive.mockResolvedValueOnce({
        duration: 60,
        price: null,
      });

      await expect(
        recurringService.createForClientPlan(tx, schedule, COMPANY_ID, "UTC"),
      ).resolves.toBeDefined();
    });

    it("deve manter as regras de agenda: dia menor que a duração do serviço", async () => {
      await expect(
        recurringService.createForClientPlan(
          tx,
          {
            ...schedule,
            days: [
              { weekDay: "TUESDAY", startTime: "14:00", endTime: "14:30" },
            ],
          },
          COMPANY_ID,
          "UTC",
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.recurringAppointment.create).not.toHaveBeenCalled();
    });

    it("deve encerrar as agendas do plano e cancelar os agendamentos futuros", async () => {
      prismaMock.recurringAppointment.findMany.mockResolvedValueOnce([
        { id: "recurring-1" },
        { id: "recurring-2" },
      ]);

      await recurringService.endForClientPlan(tx, "client-plan-1", COMPANY_ID);

      expect(prismaMock.recurringAppointment.findMany).toHaveBeenCalledWith({
        where: {
          clientPlanId: "client-plan-1",
          companyId: COMPANY_ID,
          isActive: true,
        },
        select: { id: true },
      });
      expect(prismaMock.recurringAppointment.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["recurring-1", "recurring-2"] } },
        data: { isActive: false, updatedAt: anyDate },
      });
      expect(
        appointmentServiceMock.cancelFutureFromRecurrence,
      ).toHaveBeenCalledTimes(2);
      expect(
        appointmentServiceMock.cancelFutureFromRecurrence,
      ).toHaveBeenCalledWith(prismaMock, "recurring-2", anyDate);
    });

    it("deve recusar encerrar isoladamente a recorrência de um plano", async () => {
      prismaMock.recurringAppointment.findFirst.mockResolvedValueOnce({
        ...stored,
        clientPlanId: "client-plan-1",
      });

      await expect(
        recurringService.update("recurring-1", { isActive: false }, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.recurringAppointment.update).not.toHaveBeenCalled();
    });

    it("deve permitir mudar a observação da recorrência de um plano", async () => {
      prismaMock.recurringAppointment.findFirst.mockResolvedValueOnce({
        ...stored,
        clientPlanId: "client-plan-1",
      });

      await expect(
        recurringService.update(
          "recurring-1",
          { note: "preferência por manhã" },
          COMPANY_ID,
        ),
      ).resolves.toBeDefined();
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
