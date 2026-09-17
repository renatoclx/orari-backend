import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { PrismaService } from "../../prisma/prisma.service";
import { PeopleService } from "../people/people.service";
import { BusinessHourService } from "../business-hour/business-hour.service";
import { ServiceService } from "../service/service.service";
import { AppointmentService } from "./appointment.service";
import { CreateAppointmentDto } from "./dto/create-appointment.dto";

const anyDate: unknown = expect.any(Date);

describe("AppointmentService", () => {
  let appointmentService: AppointmentService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    appointment: {
      create: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };
  const peopleServiceMock = { findOne: vi.fn() };
  const serviceServiceMock = { findActive: vi.fn() };
  const businessHourServiceMock = { ensureWithinBusinessHours: vi.fn() };

  // Sempre no futuro: agendar no passado é recusado.
  const startAt = new Date(Date.now() + 7 * 86_400_000);
  const endAt = new Date(startAt.getTime() + 30 * 60_000);
  const dto: CreateAppointmentDto = {
    clientId: "client-1",
    professionalId: "professional-1",
    serviceId: "service-1",
    startAt,
  };
  const appointment = {
    id: "appointment-1",
    ...dto,
    endAt,
    status: "SCHEDULED",
    companyId: COMPANY_ID,
  };

  const asClient = { id: "client-1", type: "CLIENT" };
  const asProfessional = { id: "professional-1", type: "PROFESSIONAL" };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Por padrão: pessoas com os tipos corretos, serviço de 30 minutos e agenda livre.
    peopleServiceMock.findOne.mockImplementation((id: string) =>
      id === "client-1" ? asClient : asProfessional,
    );
    serviceServiceMock.findActive.mockResolvedValue({ duration: 30 });
    prismaMock.appointment.findFirst.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PeopleService, useValue: peopleServiceMock },
        { provide: ServiceService, useValue: serviceServiceMock },
        { provide: BusinessHourService, useValue: businessHourServiceMock },
      ],
    }).compile();

    appointmentService = module.get<AppointmentService>(AppointmentService);
  });

  describe("create", () => {
    it("deve calcular o fim somando a duração do serviço ao início", async () => {
      await appointmentService.create(dto, COMPANY_ID);

      expect(serviceServiceMock.findActive).toHaveBeenCalledWith(
        "service-1",
        COMPANY_ID,
      );
      expect(prismaMock.appointment.create).toHaveBeenCalledWith({
        data: { ...dto, endAt, companyId: COMPANY_ID },
      });
    });

    it("deve recusar cliente que não é do tipo CLIENT", async () => {
      peopleServiceMock.findOne.mockResolvedValueOnce({
        id: "client-1",
        type: "EMPLOYEE",
      });

      await expect(
        appointmentService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    });

    it("deve recusar profissional que não é do tipo PROFESSIONAL", async () => {
      peopleServiceMock.findOne
        .mockResolvedValueOnce(asClient)
        .mockResolvedValueOnce({ id: "professional-1", type: "CLIENT" });

      await expect(
        appointmentService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("deve recusar pessoa de outra empresa", async () => {
      peopleServiceMock.findOne.mockRejectedValueOnce(new NotFoundException());

      await expect(
        appointmentService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("deve procurar conflito ignorando cancelados e considerando as duas pontas", async () => {
      await appointmentService.create(dto, COMPANY_ID);

      expect(prismaMock.appointment.findFirst).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY_ID,
          status: { not: "CANCELLED" },
          id: undefined,
          startAt: { lt: endAt },
          endAt: { gt: startAt },
          OR: [{ professionalId: "professional-1" }, { clientId: "client-1" }],
        },
        select: { professionalId: true },
      });
    });

    it("deve recusar horário ocupado pelo profissional", async () => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        professionalId: "professional-1",
      });

      await expect(
        appointmentService.create(dto, COMPANY_ID),
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof ConflictException &&
          /profissional/i.test(error.message),
      );
      expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    });

    it("deve recusar horário ocupado pelo cliente", async () => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        professionalId: "outro-profissional",
      });

      await expect(
        appointmentService.create(dto, COMPANY_ID),
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof ConflictException && /cliente/i.test(error.message),
      );
    });
  });

  describe("janela de atendimento", () => {
    it("deve validar o intervalo calculado contra o horário de funcionamento", async () => {
      await appointmentService.create(dto, COMPANY_ID);

      expect(
        businessHourServiceMock.ensureWithinBusinessHours,
      ).toHaveBeenCalledWith(COMPANY_ID, startAt, endAt);
    });

    it("não deve criar quando o horário está fora do funcionamento", async () => {
      businessHourServiceMock.ensureWithinBusinessHours.mockRejectedValueOnce(
        new BadRequestException(),
      );

      await expect(
        appointmentService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    });

    it("não deve validar a janela ao apenas cancelar", async () => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce(appointment);

      await appointmentService.update(
        "appointment-1",
        { status: "CANCELLED" },
        COMPANY_ID,
      );

      expect(
        businessHourServiceMock.ensureWithinBusinessHours,
      ).not.toHaveBeenCalled();
    });
  });

  describe("apoio à recorrência", () => {
    const occurrences = [
      {
        startAt: new Date("2026-10-06T14:00:00.000Z"),
        endAt: new Date("2026-10-06T14:30:00.000Z"),
      },
      {
        startAt: new Date("2026-10-13T14:00:00.000Z"),
        endAt: new Date("2026-10-13T14:30:00.000Z"),
      },
    ];
    const recurrenceData = {
      companyId: COMPANY_ID,
      recurringAppointmentId: "recurring-1",
      clientId: "client-1",
      professionalId: "professional-1",
      serviceId: "service-1",
    };

    it("deve validar cada ocorrência e criar todas de uma vez", async () => {
      prismaMock.appointment.createMany.mockResolvedValue({ count: 2 });

      const created = await appointmentService.createFromRecurrence(
        prismaMock as never,
        recurrenceData,
        occurrences,
        "sessão semanal",
      );

      expect(created).toBe(2);
      expect(
        businessHourServiceMock.ensureWithinBusinessHours,
      ).toHaveBeenCalledTimes(2);
      expect(prismaMock.appointment.findFirst).toHaveBeenCalledTimes(2);
      expect(prismaMock.appointment.createMany).toHaveBeenCalledWith({
        data: occurrences.map((occurrence) => ({
          ...recurrenceData,
          ...occurrence,
          note: "sessão semanal",
        })),
      });
    });

    it("deve abortar sem criar nada quando uma ocorrência conflita", async () => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        professionalId: "professional-1",
      });

      await expect(
        appointmentService.createFromRecurrence(
          prismaMock as never,
          recurrenceData,
          occurrences,
        ),
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof ConflictException &&
          error.message.includes("2026-10-06T14:00:00.000Z"),
      );
      expect(prismaMock.appointment.createMany).not.toHaveBeenCalled();
    });

    it("deve cancelar apenas os futuros ainda em SCHEDULED", async () => {
      prismaMock.appointment.updateMany.mockResolvedValue({ count: 3 });
      const from = new Date("2026-10-01T00:00:00.000Z");

      const cancelled = await appointmentService.cancelFutureFromRecurrence(
        prismaMock as never,
        "recurring-1",
        from,
      );

      expect(cancelled).toBe(3);
      expect(prismaMock.appointment.updateMany).toHaveBeenCalledWith({
        where: {
          recurringAppointmentId: "recurring-1",
          status: "SCHEDULED",
          startAt: { gte: from },
        },
        data: { status: "CANCELLED", updatedAt: anyDate },
      });
    });
  });

  describe("data no passado", () => {
    it("deve recusar agendamento com início no passado", async () => {
      await expect(
        appointmentService.create(
          { ...dto, startAt: new Date(Date.now() - 60_000) },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    });

    it("deve recusar remarcação para o passado", async () => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce(appointment);

      await expect(
        appointmentService.update(
          "appointment-1",
          { startAt: new Date(Date.now() - 60_000) },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("deve permitir editar o status de um agendamento já realizado", async () => {
      prismaMock.appointment.findFirst
        .mockResolvedValueOnce({
          ...appointment,
          startAt: new Date(Date.now() - 86_400_000),
        })
        .mockResolvedValueOnce(null);

      await appointmentService.update(
        "appointment-1",
        { status: "COMPLETED" },
        COMPANY_ID,
      );

      expect(prismaMock.appointment.update).toHaveBeenCalled();
    });
  });

  describe("findAll", () => {
    it("deve filtrar por empresa, status, participantes e período", async () => {
      prismaMock.appointment.findMany.mockResolvedValue([appointment]);
      prismaMock.appointment.count.mockResolvedValue(1);
      const from = new Date("2026-10-01T00:00:00.000Z");
      const to = new Date("2026-10-02T00:00:00.000Z");

      await appointmentService.findAll(
        {
          page: 1,
          limit: 10,
          status: "SCHEDULED",
          professionalId: "professional-1",
          clientId: "client-1",
          from,
          to,
        },
        COMPANY_ID,
      );

      expect(prismaMock.appointment.count).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY_ID,
          status: "SCHEDULED",
          professionalId: "professional-1",
          clientId: "client-1",
          startAt: { gte: from, lt: to },
        },
      });
    });
  });

  describe("update", () => {
    beforeEach(() => {
      prismaMock.appointment.findFirst.mockResolvedValue(appointment);
    });

    it("deve recalcular o fim quando o início muda", async () => {
      const novoInicio = new Date(startAt.getTime() + 2 * 3_600_000);
      // findFirst é usado para buscar o agendamento e depois para checar conflito.
      prismaMock.appointment.findFirst
        .mockResolvedValueOnce(appointment)
        .mockResolvedValueOnce(null);

      await appointmentService.update(
        "appointment-1",
        { startAt: novoInicio },
        COMPANY_ID,
      );

      expect(prismaMock.appointment.update).toHaveBeenCalledWith({
        where: { id: "appointment-1" },
        data: {
          startAt: novoInicio,
          endAt: new Date(novoInicio.getTime() + 30 * 60_000),
          updatedAt: anyDate,
        },
      });
    });

    it("não deve recalcular o fim quando só a observação muda", async () => {
      prismaMock.appointment.findFirst
        .mockResolvedValueOnce(appointment)
        .mockResolvedValueOnce(null);

      await appointmentService.update(
        "appointment-1",
        { note: "cliente avisou que virá" },
        COMPANY_ID,
      );

      expect(serviceServiceMock.findActive).not.toHaveBeenCalled();
      expect(prismaMock.appointment.update).toHaveBeenCalledWith({
        where: { id: "appointment-1" },
        data: {
          note: "cliente avisou que virá",
          endAt,
          updatedAt: anyDate,
        },
      });
    });

    it("não deve checar conflito ao cancelar", async () => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce(appointment);

      await appointmentService.update(
        "appointment-1",
        { status: "CANCELLED" },
        COMPANY_ID,
      );

      expect(prismaMock.appointment.findFirst).toHaveBeenCalledTimes(1);
      expect(prismaMock.appointment.update).toHaveBeenCalled();
    });

    it("deve ignorar o próprio agendamento ao checar conflito", async () => {
      prismaMock.appointment.findFirst
        .mockResolvedValueOnce(appointment)
        .mockResolvedValueOnce(null);

      await appointmentService.update(
        "appointment-1",
        { note: "x" },
        COMPANY_ID,
      );

      expect(prismaMock.appointment.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { not: "appointment-1" },
          }) as unknown,
        }),
      );
    });

    it("deve lançar NotFoundException para agendamento de outra empresa", async () => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce(null);

      await expect(
        appointmentService.update("appointment-1", { note: "x" }, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
