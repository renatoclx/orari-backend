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

// Cliente, profissional e serviço devolvidos junto com cada agendamento.
const relations = {
  client: { select: { id: true, name: true, photoUrl: true } },
  professional: { select: { id: true, name: true, photoUrl: true } },
  service: { select: { id: true, name: true, color: true, duration: true } },
};

describe("AppointmentService", () => {
  let appointmentService: AppointmentService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    appointment: {
      create: vi.fn(),
      createManyAndReturn: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };
  const peopleServiceMock = { findOne: vi.fn() };
  const serviceServiceMock = { findActive: vi.fn() };
  const businessHourServiceMock = {
    ensureWithinBusinessHours: vi.fn(),
    isWithinBusinessHours: vi.fn(),
  };

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
    overBooking: false,
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
    // Padrão: horário dentro do funcionamento (sem encaixe).
    businessHourServiceMock.isWithinBusinessHours.mockResolvedValue(true);
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
        data: { ...dto, endAt, companyId: COMPANY_ID, overBooking: false },
        include: relations,
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

  describe("janela de atendimento e encaixe", () => {
    const outsideMessage =
      "O horário está fora do funcionamento da empresa. Para agendar mesmo assim, envie overBooking: true (encaixe)";
    const createdData = () =>
      (
        prismaMock.appointment.create.mock.calls[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;
    const updatedData = () =>
      (
        prismaMock.appointment.update.mock.calls[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;

    it("deve verificar o intervalo calculado contra o horário de funcionamento", async () => {
      await appointmentService.create(dto, COMPANY_ID);

      expect(
        businessHourServiceMock.isWithinBusinessHours,
      ).toHaveBeenCalledWith(COMPANY_ID, startAt, endAt);
      expect(createdData().overBooking).toBe(false);
    });

    it("deve recusar horário fora do funcionamento sem a autorização de encaixe", async () => {
      businessHourServiceMock.isWithinBusinessHours.mockResolvedValue(false);

      await expect(appointmentService.create(dto, COMPANY_ID)).rejects.toThrow(
        outsideMessage,
      );
      await expect(
        appointmentService.create({ ...dto, overBooking: false }, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    });

    it("deve criar como encaixe quando autorizado e fora do funcionamento", async () => {
      businessHourServiceMock.isWithinBusinessHours.mockResolvedValue(false);

      await appointmentService.create(
        { ...dto, overBooking: true },
        COMPANY_ID,
      );

      expect(createdData().overBooking).toBe(true);
    });

    it("deve gravar false quando autorizado mas o horário está dentro", async () => {
      await appointmentService.create(
        { ...dto, overBooking: true },
        COMPANY_ID,
      );

      expect(createdData().overBooking).toBe(false);
    });

    it("deve manter a checagem de conflito no encaixe: sem sobreposição", async () => {
      businessHourServiceMock.isWithinBusinessHours.mockResolvedValue(false);
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        professionalId: "professional-1",
      });

      await expect(
        appointmentService.create({ ...dto, overBooking: true }, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.appointment.create).not.toHaveBeenCalled();
    });

    it("PATCH: mover para fora do funcionamento exige a autorização", async () => {
      businessHourServiceMock.isWithinBusinessHours.mockResolvedValue(false);
      prismaMock.appointment.findFirst.mockResolvedValueOnce(appointment);
      const novoInicio = new Date(startAt.getTime() + 12 * 3_600_000);

      await expect(
        appointmentService.update(
          "appointment-1",
          { startAt: novoInicio },
          COMPANY_ID,
        ),
      ).rejects.toThrow(outsideMessage);
      expect(prismaMock.appointment.update).not.toHaveBeenCalled();
    });

    it("PATCH: mover para fora com autorização vira encaixe", async () => {
      businessHourServiceMock.isWithinBusinessHours.mockResolvedValue(false);
      prismaMock.appointment.findFirst
        .mockResolvedValueOnce(appointment)
        .mockResolvedValueOnce(null);
      const novoInicio = new Date(startAt.getTime() + 12 * 3_600_000);

      await appointmentService.update(
        "appointment-1",
        { startAt: novoInicio, overBooking: true },
        COMPANY_ID,
      );

      expect(updatedData().overBooking).toBe(true);
    });

    it("PATCH: mover um encaixe de volta para dentro grava false", async () => {
      prismaMock.appointment.findFirst
        .mockResolvedValueOnce({ ...appointment, overBooking: true })
        .mockResolvedValueOnce(null);
      const novoInicio = new Date(startAt.getTime() + 3_600_000);

      await appointmentService.update(
        "appointment-1",
        { startAt: novoInicio },
        COMPANY_ID,
      );

      expect(updatedData().overBooking).toBe(false);
    });

    it("PATCH: sem mudar horário nem serviço, mantém o valor e ignora o overBooking enviado", async () => {
      prismaMock.appointment.findFirst
        .mockResolvedValueOnce({ ...appointment, overBooking: true })
        .mockResolvedValueOnce(null);

      await appointmentService.update(
        "appointment-1",
        { note: "confirmado", overBooking: false },
        COMPANY_ID,
      );

      expect(
        businessHourServiceMock.isWithinBusinessHours,
      ).not.toHaveBeenCalled();
      expect(updatedData().overBooking).toBe(true);
    });

    it("não deve validar a janela ao apenas cancelar", async () => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce(appointment);

      await appointmentService.update(
        "appointment-1",
        { status: "CANCELLED" },
        COMPANY_ID,
      );

      expect(
        businessHourServiceMock.isWithinBusinessHours,
      ).not.toHaveBeenCalled();
    });

    it("recorrência continua exigindo a janela: sem encaixe", async () => {
      await appointmentService.createFromRecurrence(
        prismaMock as never,
        {
          companyId: COMPANY_ID,
          recurringAppointmentId: "recurring-1",
          clientId: "client-1",
          professionalId: "professional-1",
          serviceId: "service-1",
        },
        [{ startAt, endAt }],
      );

      expect(
        businessHourServiceMock.ensureWithinBusinessHours,
      ).toHaveBeenCalledWith(COMPANY_ID, startAt, endAt);
      expect(
        businessHourServiceMock.isWithinBusinessHours,
      ).not.toHaveBeenCalled();
    });
  });

  describe("apoio ao job de cobrança", () => {
    it("deve buscar avulsos concluídos, sem pagamento e com serviço com preço, de todas as empresas", async () => {
      prismaMock.appointment.findMany.mockResolvedValue([]);

      await appointmentService.findCompletedStandaloneWithoutPayment();

      expect(prismaMock.appointment.findMany).toHaveBeenCalledWith({
        where: {
          status: "COMPLETED",
          recurringAppointmentId: null,
          payment: { is: null },
          service: { price: { not: null } },
        },
        select: {
          id: true,
          companyId: true,
          startAt: true,
          service: { select: { price: true } },
          company: { select: { timezone: true } },
        },
      });
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
      const returned = occurrences.map((occurrence, index) => ({
        id: `appointment-${index + 1}`,
        startAt: occurrence.startAt,
      }));
      prismaMock.appointment.createManyAndReturn.mockResolvedValue(returned);

      const created = await appointmentService.createFromRecurrence(
        prismaMock as never,
        recurrenceData,
        occurrences,
        "sessão semanal",
      );

      expect(created).toEqual(returned);
      expect(
        businessHourServiceMock.ensureWithinBusinessHours,
      ).toHaveBeenCalledTimes(2);
      expect(prismaMock.appointment.findFirst).toHaveBeenCalledTimes(2);
      expect(prismaMock.appointment.createManyAndReturn).toHaveBeenCalledWith({
        data: occurrences.map((occurrence) => ({
          ...recurrenceData,
          ...occurrence,
          note: "sessão semanal",
        })),
        select: { id: true, startAt: true },
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
      expect(prismaMock.appointment.createManyAndReturn).not.toHaveBeenCalled();
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

  describe("remanejamento de recorrência", () => {
    const fromRecurrence = {
      ...appointment,
      recurringAppointmentId: "recurring-1",
    } as never;
    const newStartAt = new Date(startAt.getTime() + 86_400_000);

    it("deve remarcar o mesmo registro recalculando o fim", async () => {
      await appointmentService.rescheduleFromRecurrence(
        prismaMock as never,
        fromRecurrence,
        newStartAt,
      );

      expect(
        businessHourServiceMock.ensureWithinBusinessHours,
      ).toHaveBeenCalled();
      expect(prismaMock.appointment.update).toHaveBeenCalledWith({
        where: { id: "appointment-1" },
        data: {
          startAt: newStartAt,
          endAt: new Date(newStartAt.getTime() + 30 * 60_000),
          updatedAt: anyDate,
        },
      });
    });

    it("deve recusar quando o novo horário está ocupado", async () => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        professionalId: "professional-1",
      });

      await expect(
        appointmentService.rescheduleFromRecurrence(
          prismaMock as never,
          fromRecurrence,
          newStartAt,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.appointment.update).not.toHaveBeenCalled();
    });

    it.each(["COMPLETED", "CANCELLED", "NO_SHOW", "IN_PROGRESS"])(
      "deve recusar agendamento com status %s",
      async (status) => {
        await expect(
          appointmentService.rescheduleFromRecurrence(
            prismaMock as never,
            { ...appointment, status } as never,
            newStartAt,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it("deve aceitar agendamento CONFIRMED", async () => {
      await expect(
        appointmentService.rescheduleFromRecurrence(
          prismaMock as never,
          { ...appointment, status: "CONFIRMED" } as never,
          newStartAt,
        ),
      ).resolves.not.toThrow();
    });

    it.each([
      { startAt: newStartAt },
      { serviceId: "service-2" },
      { clientId: "client-2" },
      { professionalId: "professional-2" },
    ])("deve recusar %o no PATCH comum", async (change) => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce(fromRecurrence);

      await expect(
        appointmentService.update("appointment-1", change, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.appointment.update).not.toHaveBeenCalled();
    });

    it("deve recusar cancelamento pelo PATCH comum", async () => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce(fromRecurrence);

      await expect(
        appointmentService.update(
          "appointment-1",
          { status: "CANCELLED" },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.appointment.update).not.toHaveBeenCalled();
    });

    it("deve cancelar pelo apoio à recorrência", async () => {
      await appointmentService.cancelFromRecurrence(
        prismaMock as never,
        fromRecurrence,
      );

      expect(prismaMock.appointment.update).toHaveBeenCalledWith({
        where: { id: "appointment-1" },
        data: { status: "CANCELLED", updatedAt: anyDate },
      });
    });

    it("não deve cancelar agendamento já concluído", async () => {
      await expect(
        appointmentService.cancelFromRecurrence(
          prismaMock as never,
          { ...appointment, status: "COMPLETED" } as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.appointment.update).not.toHaveBeenCalled();
    });

    it("deve permitir status e observação no PATCH comum", async () => {
      prismaMock.appointment.findFirst
        .mockResolvedValueOnce(fromRecurrence)
        .mockResolvedValue(null);

      await appointmentService.update(
        "appointment-1",
        { status: "CONFIRMED", note: "confirmado por telefone" },
        COMPANY_ID,
      );

      expect(prismaMock.appointment.update).toHaveBeenCalled();
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

    it("deve incluir cliente, profissional e serviço, ordenando por início e id", async () => {
      prismaMock.appointment.findMany.mockResolvedValue([]);
      prismaMock.appointment.count.mockResolvedValue(0);

      await appointmentService.findAll({ page: 2, limit: 100 }, COMPANY_ID);

      expect(prismaMock.appointment.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ companyId: COMPANY_ID }) as unknown,
        include: relations,
        // O id desempata horários iguais e mantém a paginação estável.
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
        skip: 100,
        take: 100,
      });
    });

    it("não deve trazer dados além de id, nome, foto, cor e duração", () => {
      const fields = (select: Record<string, unknown>) => Object.keys(select);

      expect(fields(relations.client.select)).toEqual([
        "id",
        "name",
        "photoUrl",
      ]);
      expect(fields(relations.professional.select)).toEqual([
        "id",
        "name",
        "photoUrl",
      ]);
      expect(fields(relations.service.select)).toEqual([
        "id",
        "name",
        "color",
        "duration",
      ]);
    });
  });

  describe("findDetail", () => {
    it("deve devolver o agendamento com os dados relacionados da própria empresa", async () => {
      prismaMock.appointment.findFirst.mockResolvedValue(appointment);

      await expect(
        appointmentService.findDetail("appointment-1", COMPANY_ID),
      ).resolves.toEqual(appointment);
      expect(prismaMock.appointment.findFirst).toHaveBeenCalledWith({
        where: { id: "appointment-1", companyId: COMPANY_ID },
        include: relations,
      });
    });

    it("deve lançar NotFoundException para agendamento de outra empresa", async () => {
      prismaMock.appointment.findFirst.mockResolvedValue(null);

      await expect(
        appointmentService.findDetail("appointment-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("não deve alterar o findOne usado pelos outros módulos: sem include", async () => {
      prismaMock.appointment.findFirst.mockResolvedValue(appointment);

      await appointmentService.findOne("appointment-1", COMPANY_ID);

      expect(prismaMock.appointment.findFirst).toHaveBeenCalledWith({
        where: { id: "appointment-1", companyId: COMPANY_ID },
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
          overBooking: false,
          updatedAt: anyDate,
        },
        include: relations,
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
          overBooking: false,
          updatedAt: anyDate,
        },
        include: relations,
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
