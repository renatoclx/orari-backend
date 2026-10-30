import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PeopleService } from "../people/people.service";
import { BusinessHourService } from "../business-hour/business-hour.service";
import { ServiceService } from "../service/service.service";
import { AppointmentService } from "./appointment.service";
import { CreateAppointmentDto } from "./dto/create-appointment.dto";

const anyDate: unknown = expect.any(Date);
const containingWhere = (expected: object): unknown =>
  expect.objectContaining(expected);

// Cliente, profissional, serviço, origem, situação do pagamento e sessão da
// turma devolvidos junto com cada agendamento.
const relations = {
  client: { select: { id: true, name: true, photoUrl: true } },
  professional: { select: { id: true, name: true, photoUrl: true } },
  service: { select: { id: true, name: true, color: true, duration: true } },
  recurringAppointment: { select: { id: true, clientPlanId: true } },
  payment: { select: { status: true, deletedAt: true } },
  classSession: { select: { id: true, classGroupId: true, capacity: true } },
};

describe("AppointmentService", () => {
  let appointmentService: AppointmentService;
  const prismaMock = {
    // Suporta as duas formas: lista de operações e transação interativa.
    $transaction: vi.fn(
      (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
        typeof arg === "function" ? arg(prismaMock) : Promise.all(arg),
    ),
    payment: { updateMany: vi.fn(), count: vi.fn() },
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
    // Padrão: agendamento sem pagamento (nada o trava).
    prismaMock.payment.count.mockResolvedValue(0);
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
        "UTC",
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
        "UTC",
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

    it("deve informar a data e o horário no fuso da empresa, não em UTC", async () => {
      // 14:00 UTC é 11:00 em São Paulo (UTC-3).
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        clientId: "client-1",
      });

      await expect(
        appointmentService.createFromRecurrence(
          prismaMock as never,
          recurrenceData,
          occurrences,
          "America/Sao_Paulo",
        ),
      ).rejects.toThrow(
        "Conflito em 06/10/2026 às 11:00: O cliente já possui um agendamento neste horário",
      );
    });

    it("deve apontar a data da ocorrência que conflitou, não a da primeira", async () => {
      prismaMock.appointment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ professionalId: "professional-1" });

      await expect(
        appointmentService.createFromRecurrence(
          prismaMock as never,
          recurrenceData,
          occurrences,
          "UTC",
        ),
      ).rejects.toThrow("Conflito em 13/10/2026 às 14:00:");
      expect(prismaMock.appointment.createManyAndReturn).not.toHaveBeenCalled();
    });

    it("horário fora do funcionamento também informa a data e mantém o 400", async () => {
      businessHourServiceMock.ensureWithinBusinessHours.mockRejectedValueOnce(
        new BadRequestException(
          "O horário está fora do funcionamento da empresa",
        ),
      );

      await expect(
        appointmentService.createFromRecurrence(
          prismaMock as never,
          recurrenceData,
          occurrences,
          "UTC",
        ),
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof BadRequestException &&
          error.message ===
            "Conflito em 06/10/2026 às 14:00: O horário está fora do funcionamento da empresa",
      );
    });

    it("outros erros seguem sem o prefixo de data", async () => {
      prismaMock.appointment.findFirst.mockRejectedValueOnce(
        new Error("banco"),
      );

      await expect(
        appointmentService.createFromRecurrence(
          prismaMock as never,
          recurrenceData,
          occurrences,
          "UTC",
        ),
      ).rejects.toThrow(/^banco$/);
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
          "UTC",
        ),
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof ConflictException &&
          error.message ===
            "Conflito em 06/10/2026 às 14:00: O profissional já possui um agendamento neste horário",
      );
      expect(prismaMock.appointment.createManyAndReturn).not.toHaveBeenCalled();
    });

    it("deve cancelar os futuros ainda em SCHEDULED ou CONFIRMED", async () => {
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
          status: { in: ["SCHEDULED", "CONFIRMED"] },
          startAt: { gte: from },
        },
        data: { status: "CANCELLED", updatedAt: anyDate },
      });
    });

    it("deve cancelar as aulas futuras da recorrência só nas sessões da turma, com o motivo", async () => {
      prismaMock.appointment.updateMany.mockResolvedValue({ count: 2 });
      const from = new Date("2026-10-01T00:00:00.000Z");

      await expect(
        appointmentService.cancelFutureFromClassGroup(
          prismaMock as never,
          "recurring-1",
          "group-1",
          from,
        ),
      ).resolves.toBe(2);
      expect(prismaMock.appointment.updateMany).toHaveBeenCalledWith({
        where: {
          recurringAppointmentId: "recurring-1",
          status: { in: ["SCHEDULED", "CONFIRMED"] },
          startAt: { gte: from },
          classSession: { classGroupId: "group-1" },
        },
        data: {
          status: "CANCELLED",
          cancelReason: "CLASS_LEFT",
          updatedAt: anyDate,
        },
      });
    });
  });

  describe("cancelamento da sessão de turma", () => {
    it("deve cancelar os agendamentos que ainda não aconteceram, com o motivo", async () => {
      prismaMock.appointment.updateMany.mockResolvedValue({ count: 4 });

      await expect(
        appointmentService.cancelForClassSession(
          prismaMock as never,
          "session-1",
        ),
      ).resolves.toBe(4);
      expect(prismaMock.appointment.updateMany).toHaveBeenCalledWith({
        where: {
          classSessionId: "session-1",
          status: { in: ["SCHEDULED", "CONFIRMED"] },
        },
        data: {
          status: "CANCELLED",
          cancelReason: "CLASS_SESSION_CANCELLED",
          updatedAt: anyDate,
        },
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
          professionalId: "professional-1",
          // Remanejar tira o aluno da sessão de turma, se houver (vira atendimento individual).
          classSessionId: null,
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

    it.each(["SCHEDULED", "CONFIRMED"])(
      "deve recusar remanejar %s cujo início já passou, mesmo antes de o job mudar o status",
      async (status) => {
        await expect(
          appointmentService.rescheduleFromRecurrence(
            prismaMock as never,
            {
              ...appointment,
              recurringAppointmentId: "recurring-1",
              status,
              startAt: new Date(Date.now() - 60_000),
            } as never,
            newStartAt,
          ),
        ).rejects.toThrow("Agendamento que já iniciou não pode ser remanejado");
        expect(prismaMock.appointment.update).not.toHaveBeenCalled();
      },
    );

    describe("reposição de pacote após falta (NO_SHOW)", () => {
      const noShow = {
        ...appointment,
        recurringAppointmentId: "recurring-1",
        status: "NO_SHOW",
        startAt: new Date(Date.now() - 86_400_000),
      };
      const replace = (appt: object = noShow, allowReplacement = true) =>
        appointmentService.rescheduleFromRecurrence(
          prismaMock as never,
          appt as never,
          newStartAt,
          { allowReplacement },
        );

      it("deve remanejar a sessão com falta para a nova data e voltá-la a SCHEDULED", async () => {
        await replace();

        expect(prismaMock.appointment.update).toHaveBeenCalledWith({
          where: { id: "appointment-1" },
          data: {
            startAt: newStartAt,
            endAt: new Date(newStartAt.getTime() + 30 * 60_000),
            professionalId: "professional-1",
            classSessionId: null,
            status: "SCHEDULED",
            cancelReason: null,
            updatedAt: anyDate,
          },
        });
      });

      it("deve manter as validações da nova data: futura, funcionamento e conflito", async () => {
        await expect(
          appointmentService.rescheduleFromRecurrence(
            prismaMock as never,
            noShow as never,
            new Date(Date.now() - 60_000),
            { allowReplacement: true },
          ),
        ).rejects.toBeInstanceOf(BadRequestException);

        prismaMock.appointment.findFirst.mockResolvedValueOnce({
          professionalId: "professional-1",
        });
        await expect(replace()).rejects.toBeInstanceOf(ConflictException);
        expect(prismaMock.appointment.update).not.toHaveBeenCalled();
      });

      it("não deve valer sem a autorização do pacote (recorrência avulsa)", async () => {
        await expect(replace(noShow, false)).rejects.toThrow(
          "Agendamento com status NO_SHOW não pode ser remanejado",
        );
        expect(prismaMock.appointment.update).not.toHaveBeenCalled();
      });

      it.each(["CLASS_SESSION_CANCELLED", "CLASS_LEFT"])(
        "deve repor a sessão cancelada pela turma (%s) e limpar o motivo",
        async (cancelReason) => {
          await replace({ ...noShow, status: "CANCELLED", cancelReason });

          const { data } = prismaMock.appointment.update.mock.calls[0][0] as {
            data: Record<string, unknown>;
          };
          expect(data).toMatchObject({
            status: "SCHEDULED",
            cancelReason: null,
          });
        },
      );

      it("não deve repor a sessão cancelada pela turma sem a autorização do pacote", async () => {
        await expect(
          replace(
            { ...noShow, status: "CANCELLED", cancelReason: "CLASS_LEFT" },
            false,
          ),
        ).rejects.toThrow(
          "Agendamento com status CANCELLED não pode ser remanejado",
        );
      });

      // O CANCELLED aqui é o cancelado pelo cliente (sem motivo): não tem reposição.
      it.each(["COMPLETED", "IN_PROGRESS", "CANCELLED"])(
        "mesmo no pacote, continua recusando a sessão %s",
        async (status) => {
          await expect(replace({ ...noShow, status })).rejects.toBeInstanceOf(
            BadRequestException,
          );
          expect(prismaMock.appointment.update).not.toHaveBeenCalled();
        },
      );

      it("remanejar antes de iniciar não muda o status, no pacote ou fora dele", async () => {
        await replace({ ...appointment, status: "CONFIRMED" });

        const { data } = prismaMock.appointment.update.mock.calls[0][0] as {
          data: Record<string, unknown>;
        };
        expect(data.status).toBeUndefined();
      });
    });

    it("deve levar a aula para a sessão de turma de destino, com o profissional dela", async () => {
      await appointmentService.rescheduleFromRecurrence(
        prismaMock as never,
        fromRecurrence,
        newStartAt,
        {
          classSession: { id: "session-2", professionalId: "professional-2" },
        },
      );

      // O conflito do profissional não conta os colegas da sessão de destino.
      expect(prismaMock.appointment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              {
                professionalId: "professional-2",
                OR: [
                  { classSessionId: null },
                  { classSessionId: { not: "session-2" } },
                ],
              },
              { clientId: "client-1" },
            ],
          }) as unknown,
        }),
      );
      expect(prismaMock.appointment.update).toHaveBeenCalledWith({
        where: { id: "appointment-1" },
        data: expect.objectContaining({
          professionalId: "professional-2",
          classSessionId: "session-2",
        }) as unknown,
      });
    });

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

    it("deve recusar cancelar sessão cujo início já passou, mesmo ainda SCHEDULED", async () => {
      // O job de status roda a cada 5 minutos: a sessão pode já ter começado.
      await expect(
        appointmentService.cancelFromRecurrence(
          prismaMock as never,
          {
            ...appointment,
            recurringAppointmentId: "recurring-1",
            status: "SCHEDULED",
            startAt: new Date(Date.now() - 60_000),
          } as never,
        ),
      ).rejects.toThrow("Agendamento que já iniciou não pode ser cancelado");
      expect(prismaMock.appointment.update).not.toHaveBeenCalled();
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

  describe("cancelamento (só antes de iniciar)", () => {
    const future = new Date(Date.now() + 2 * 3_600_000);
    const past = new Date(Date.now() - 60_000);
    const cancel = (current: Record<string, unknown>, extra = {}) => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        ...appointment,
        ...current,
      });
      return appointmentService.update(
        "appointment-1",
        { status: "CANCELLED", ...extra },
        COMPANY_ID,
      );
    };

    it.each(["SCHEDULED", "CONFIRMED"])(
      "deve cancelar %s futuro e o pagamento PENDING dele, na mesma transação",
      async (status) => {
        await cancel({ status, startAt: future });

        expect(prismaMock.$transaction).toHaveBeenCalledWith(
          expect.any(Function),
        );
        expect(prismaMock.appointment.update).toHaveBeenCalledWith(
          expect.objectContaining({
            // O status lido vai no filtro: protege de uma mudança no meio do caminho.
            where: { id: "appointment-1", status },
            data: expect.objectContaining({ status: "CANCELLED" }) as unknown,
          }),
        );
        // Só o PENDING: o PAID não muda (não há reembolso).
        expect(prismaMock.payment.updateMany).toHaveBeenCalledWith({
          where: {
            appointmentId: "appointment-1",
            status: "PENDING",
            deletedAt: null,
          },
          data: { status: "CANCELLED", updatedAt: anyDate },
        });
      },
    );

    it("deve recusar com 409, sem cancelar o pagamento, se o status mudou entre a leitura e a gravação", async () => {
      // O job de status iniciou o atendimento depois da leitura: o filtro por
      // status não encontra a linha e a operação inteira é desfeita.
      prismaMock.appointment.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Record not found", {
          code: "P2025",
          clientVersion: "test",
        }),
      );

      await expect(
        cancel({ status: "SCHEDULED", startAt: future }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      ["IN_PROGRESS", "Agendamento que já iniciou não pode ser cancelado"],
      ["COMPLETED", "Agendamento concluído não pode ser cancelado"],
      [
        "NO_SHOW",
        "Agendamento em que o cliente não compareceu não pode ser cancelado",
      ],
      ["CANCELLED", "O agendamento já está cancelado"],
    ])(
      "deve recusar com 400 o cancelamento de %s, sem alterar nada",
      async (status, message) => {
        const attempt = cancel({ status, startAt: future });

        await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
        await expect(cancel({ status, startAt: future })).rejects.toThrow(
          message,
        );
        expect(prismaMock.appointment.update).not.toHaveBeenCalled();
        expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
      },
    );

    it.each(["SCHEDULED", "CONFIRMED"])(
      "deve recusar %s cujo início já passou, mesmo antes de o job mudar o status",
      async (status) => {
        await expect(cancel({ status, startAt: past })).rejects.toThrow(
          "Agendamento que já iniciou não pode ser cancelado",
        );
        expect(prismaMock.appointment.update).not.toHaveBeenCalled();
      },
    );

    it("deve recusar o cancelamento exatamente no horário de início", async () => {
      vi.useFakeTimers();
      const now = new Date("2026-10-20T13:00:00.000Z");
      vi.setSystemTime(now);
      try {
        await expect(cancel({ startAt: now })).rejects.toThrow(
          "Agendamento que já iniciou não pode ser cancelado",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("deve aplicar a regra quando o cancelamento vem junto com outros campos", async () => {
      // Um novo horário no mesmo PATCH não "desfaz" o início já ocorrido.
      await expect(
        cancel({ startAt: past }, { startAt: future, note: "remarcar" }),
      ).rejects.toThrow("Agendamento que já iniciou não pode ser cancelado");

      prismaMock.appointment.findFirst.mockResolvedValue(null);
      await cancel({ startAt: future }, { note: "cliente desmarcou" });
      expect(prismaMock.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "CANCELLED",
            note: "cliente desmarcou",
          }) as unknown,
        }),
      );
    });

    it("deve continuar recusando o cancelamento de agendamento de recorrência pelo PATCH comum", async () => {
      await expect(
        cancel({ startAt: future, recurringAppointmentId: "recurring-1" }),
      ).rejects.toThrow(
        "Agendamento de recorrência é cancelado pelo cancelamento da recorrência",
      );
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });

    it("deve permitir alterar a observação de um agendamento já iniciado", async () => {
      prismaMock.appointment.findFirst
        .mockResolvedValueOnce({
          ...appointment,
          status: "IN_PROGRESS",
          startAt: past,
        })
        .mockResolvedValueOnce(null);

      await expect(
        appointmentService.update(
          "appointment-1",
          { note: "chegou atrasado" },
          COMPANY_ID,
        ),
      ).resolves.toBeUndefined();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("concluído com pagamento não é mais alterado", () => {
    const completed = {
      ...appointment,
      status: "COMPLETED",
      startAt: new Date(Date.now() - 86_400_000),
    };
    const lockedMessage =
      "Agendamento concluído com pagamento não pode ser alterado";

    it.each([
      ["observação", { note: "ajuste" }],
      ["status", { status: "CONFIRMED" as const }],
      ["serviço", { serviceId: "service-2" }],
      ["cliente", { clientId: "client-2" }],
      ["horário", { startAt: new Date(Date.now() + 86_400_000) }],
    ])(
      "deve recusar alterar %s com pagamento pendente ou pago",
      async (_n, change) => {
        prismaMock.appointment.findFirst.mockResolvedValue(completed);
        prismaMock.payment.count.mockResolvedValue(1);

        await expect(
          appointmentService.update("appointment-1", change, COMPANY_ID),
        ).rejects.toThrow(lockedMessage);
        expect(prismaMock.appointment.update).not.toHaveBeenCalled();
      },
    );

    it("deve contar só o pagamento pendente ou pago e não excluído", async () => {
      prismaMock.appointment.findFirst.mockResolvedValue(completed);
      prismaMock.payment.count.mockResolvedValue(1);

      await expect(
        appointmentService.update("appointment-1", { note: "x" }, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.payment.count).toHaveBeenCalledWith({
        where: {
          appointmentId: "appointment-1",
          deletedAt: null,
          status: { in: ["PENDING", "PAID"] },
        },
      });
    });

    it("deve liberar a edição quando o concluído não tem pagamento ativo", async () => {
      // Pagamento excluído ou cancelado não conta: count devolve 0.
      prismaMock.appointment.findFirst
        .mockResolvedValueOnce(completed)
        .mockResolvedValueOnce(null);

      await expect(
        appointmentService.update(
          "appointment-1",
          { note: "ajuste" },
          COMPANY_ID,
        ),
      ).resolves.toBeUndefined();
      expect(prismaMock.appointment.update).toHaveBeenCalledTimes(1);
    });

    it("não deve consultar pagamento quando o agendamento não está concluído", async () => {
      prismaMock.appointment.findFirst
        .mockResolvedValueOnce(appointment)
        .mockResolvedValueOnce(null);

      await appointmentService.update(
        "appointment-1",
        { note: "ajuste" },
        COMPANY_ID,
      );

      expect(prismaMock.payment.count).not.toHaveBeenCalled();
    });
  });

  describe("falta (o cliente não compareceu): não cobra", () => {
    const started = new Date(Date.now() - 60 * 60_000);
    const future = new Date(Date.now() + 2 * 3_600_000);
    const markNoShow = (current: Record<string, unknown>, extra = {}) => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        ...appointment,
        ...current,
      });
      return appointmentService.update(
        "appointment-1",
        { status: "NO_SHOW", ...extra },
        COMPANY_ID,
      );
    };

    it.each(["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "COMPLETED"])(
      "deve marcar a falta de %s que já iniciou e cancelar o pagamento PENDING, na mesma transação",
      async (status) => {
        prismaMock.payment.count.mockResolvedValue(0);

        await markNoShow({ status, startAt: started });

        expect(prismaMock.$transaction).toHaveBeenCalledWith(
          expect.any(Function),
        );
        expect(prismaMock.appointment.update).toHaveBeenCalledWith(
          expect.objectContaining({
            // A falta vale de qualquer status em que o atendimento já iniciou.
            where: {
              id: "appointment-1",
              status: {
                in: ["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "COMPLETED"],
              },
            },
            data: expect.objectContaining({ status: "NO_SHOW" }) as unknown,
          }),
        );
        // Só o PENDING: a falta não cobra. O PAID nunca chega aqui (é recusado).
        expect(prismaMock.payment.updateMany).toHaveBeenCalledWith({
          where: {
            appointmentId: "appointment-1",
            status: "PENDING",
            deletedAt: null,
          },
          data: { status: "CANCELLED", updatedAt: anyDate },
        });
      },
    );

    it("deve marcar a falta do concluído mesmo com pagamento pendente (antes ficava travado)", async () => {
      // Só o pagamento recebido é consultado: o pendente não impede.
      prismaMock.payment.count.mockResolvedValue(0);

      await markNoShow({ status: "COMPLETED", startAt: started });

      expect(prismaMock.payment.count).toHaveBeenCalledTimes(1);
      expect(prismaMock.payment.count).toHaveBeenCalledWith({
        where: {
          appointmentId: "appointment-1",
          deletedAt: null,
          status: "PAID",
        },
      });
    });

    it("deve permitir uma observação junto com a falta", async () => {
      prismaMock.payment.count.mockResolvedValue(0);

      await markNoShow(
        { status: "COMPLETED", startAt: started },
        { note: "Avisou que não viria" },
      );

      expect(prismaMock.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "NO_SHOW",
            note: "Avisou que não viria",
          }) as unknown,
        }),
      );
    });

    it.each(["SCHEDULED", "CONFIRMED"])(
      "deve recusar a falta de %s que ainda não iniciou, sem alterar nada",
      async (status) => {
        await expect(markNoShow({ status, startAt: future })).rejects.toThrow(
          "Só se marca falta de atendimento que já iniciou",
        );
        expect(prismaMock.appointment.update).not.toHaveBeenCalled();
        expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
      },
    );

    it("deve usar o horário, e não só o status, para saber se iniciou (o job roda a cada 5 minutos)", async () => {
      prismaMock.payment.count.mockResolvedValue(0);

      // Ainda SCHEDULED no banco, mas o horário de início já passou.
      await markNoShow({ status: "SCHEDULED", startAt: started });

      expect(prismaMock.appointment.update).toHaveBeenCalled();
    });

    it("deve recusar a falta quando o pagamento já foi recebido (não há reembolso)", async () => {
      prismaMock.payment.count.mockResolvedValue(1);

      await expect(
        markNoShow({ status: "COMPLETED", startAt: started }),
      ).rejects.toThrow(
        "Agendamento com pagamento recebido não pode ser marcado como falta",
      );
      expect(prismaMock.appointment.update).not.toHaveBeenCalled();
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      ["cliente", { clientId: "client-2" }],
      ["profissional", { professionalId: "professional-2" }],
      ["serviço", { serviceId: "service-2" }],
      ["horário", { startAt: new Date(Date.now() + 86_400_000) }],
    ])("deve recusar a falta junto com a mudança de %s", async (_n, change) => {
      await expect(
        markNoShow({ status: "COMPLETED", startAt: started }, change),
      ).rejects.toThrow("Para marcar a falta, informe só o status");
      expect(prismaMock.appointment.update).not.toHaveBeenCalled();
    });

    it("deve recusar a falta de um cancelado (estado final)", async () => {
      await expect(
        markNoShow({ status: "CANCELLED", startAt: started }),
      ).rejects.toThrow("Agendamento cancelado não pode mudar de status");
      expect(prismaMock.appointment.update).not.toHaveBeenCalled();
    });

    it("não deve checar conflito de horário ao marcar a falta (o horário não muda)", async () => {
      prismaMock.payment.count.mockResolvedValue(0);

      await markNoShow({ status: "COMPLETED", startAt: started });

      // Só a leitura do agendamento: nenhuma busca de conflito.
      expect(prismaMock.appointment.findFirst).toHaveBeenCalledTimes(1);
    });

    it("deve recusar com 409, sem cancelar o pagamento, se o agendamento foi cancelado entre a leitura e a gravação", async () => {
      prismaMock.payment.count.mockResolvedValue(0);
      // O filtro por status não encontra a linha (cancelada no meio do caminho).
      prismaMock.appointment.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Record not found", {
          code: "P2025",
          clientVersion: "test",
        }),
      );

      await expect(
        markNoShow({ status: "IN_PROGRESS", startAt: started }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });

    describe("a falta é definitiva", () => {
      const noShow = { ...appointment, status: "NO_SHOW", startAt: started };

      it.each(["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "COMPLETED"] as const)(
        "não deve mudar de NO_SHOW para %s",
        async (status) => {
          prismaMock.appointment.findFirst.mockResolvedValueOnce(noShow);

          await expect(
            appointmentService.update("appointment-1", { status }, COMPANY_ID),
          ).rejects.toThrow(
            "Agendamento em que o cliente não compareceu não pode mudar de status",
          );
          expect(prismaMock.appointment.update).not.toHaveBeenCalled();
        },
      );

      it("deve continuar permitindo alterar a observação de quem faltou", async () => {
        prismaMock.appointment.findFirst
          .mockResolvedValueOnce(noShow)
          .mockResolvedValueOnce(null);

        await appointmentService.update(
          "appointment-1",
          { note: "Remarcou por telefone" },
          COMPANY_ID,
        );

        expect(prismaMock.appointment.update).toHaveBeenCalled();
      });

      it("repetir NO_SHOW não muda nada e não mexe no pagamento", async () => {
        prismaMock.appointment.findFirst
          .mockResolvedValueOnce(noShow)
          .mockResolvedValueOnce(null);

        await appointmentService.update(
          "appointment-1",
          { status: "NO_SHOW" },
          COMPANY_ID,
        );

        expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
      });
    });
  });

  describe("cancelado é estado final", () => {
    const cancelled = { ...appointment, status: "CANCELLED" };

    it.each([
      "SCHEDULED",
      "CONFIRMED",
      "IN_PROGRESS",
      "COMPLETED",
      "NO_SHOW",
    ] as const)(
      "deve recusar com 400 voltar um agendamento cancelado para %s",
      async (status) => {
        prismaMock.appointment.findFirst.mockResolvedValue(cancelled);

        await expect(
          appointmentService.update("appointment-1", { status }, COMPANY_ID),
        ).rejects.toThrow("Agendamento cancelado não pode mudar de status");
        expect(prismaMock.appointment.update).not.toHaveBeenCalled();
      },
    );

    it("deve recusar reabrir mesmo junto com outros campos", async () => {
      prismaMock.appointment.findFirst.mockResolvedValue(cancelled);

      await expect(
        appointmentService.update(
          "appointment-1",
          { status: "SCHEDULED", note: "voltou" },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("deve recusar reabrir também um agendamento de recorrência", async () => {
      prismaMock.appointment.findFirst.mockResolvedValue({
        ...cancelled,
        recurringAppointmentId: "recurring-1",
      });

      await expect(
        appointmentService.update(
          "appointment-1",
          { status: "CONFIRMED" },
          COMPANY_ID,
        ),
      ).rejects.toThrow("Agendamento cancelado não pode mudar de status");
    });

    it("deve continuar permitindo alterar a observação de um cancelado", async () => {
      prismaMock.appointment.findFirst.mockResolvedValue(cancelled);

      await expect(
        appointmentService.update(
          "appointment-1",
          { note: "cliente desmarcou por telefone" },
          COMPANY_ID,
        ),
      ).resolves.toBeUndefined();
      expect(prismaMock.appointment.update).toHaveBeenCalledTimes(1);
    });

    it("repetir CANCELLED cai na regra do cancelamento: já está cancelado", async () => {
      prismaMock.appointment.findFirst.mockResolvedValue(cancelled);

      await expect(
        appointmentService.update(
          "appointment-1",
          { status: "CANCELLED" },
          COMPANY_ID,
        ),
      ).rejects.toThrow("O agendamento já está cancelado");
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

    it.each([
      [undefined, "asc"],
      ["desc", "desc"],
    ] as const)(
      "com order=%s ordena pelo início em %s, desempatando pelo id",
      async (order, direction) => {
        prismaMock.appointment.findMany.mockResolvedValue([]);
        prismaMock.appointment.count.mockResolvedValue(0);

        await appointmentService.findAll(
          { page: 1, limit: 10, order },
          COMPANY_ID,
        );

        const [{ orderBy }] = prismaMock.appointment.findMany.mock.calls[0] as [
          { orderBy: unknown },
        ];
        expect(orderBy).toEqual([{ startAt: direction }, { id: direction }]);
      },
    );

    it("deve filtrar as sessões de uma recorrência, mantendo o escopo da empresa", async () => {
      prismaMock.appointment.findMany.mockResolvedValue([]);
      prismaMock.appointment.count.mockResolvedValue(0);

      await appointmentService.findAll(
        { page: 1, limit: 100, recurringAppointmentId: "recurring-1" },
        COMPANY_ID,
      );

      expect(prismaMock.appointment.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          companyId: COMPANY_ID,
          recurringAppointmentId: "recurring-1",
        }) as unknown,
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
      expect(fields(relations.recurringAppointment.select)).toEqual([
        "id",
        "clientPlanId",
      ]);
      // Do pagamento, só a situação (e se foi excluído): nada de valor ou método.
      expect(fields(relations.payment.select)).toEqual(["status", "deletedAt"]);
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

  describe("turma (sessão)", () => {
    const sessionAppointment = { ...appointment, classSessionId: "session-1" };
    // Conflito do profissional sem contar os colegas da mesma sessão.
    const professionalOutsideSession = {
      professionalId: "professional-1",
      OR: [{ classSessionId: null }, { classSessionId: { not: "session-1" } }],
    };

    it("editar a observação não conflita com os colegas da sessão", async () => {
      prismaMock.appointment.findFirst
        .mockResolvedValueOnce(sessionAppointment)
        .mockResolvedValueOnce(null);

      await appointmentService.update(
        "appointment-1",
        { note: "Trouxe atestado" },
        COMPANY_ID,
      );

      expect(prismaMock.appointment.findFirst).toHaveBeenLastCalledWith({
        where: containingWhere({
          id: { not: "appointment-1" },
          OR: [professionalOutsideSession, { clientId: "client-1" }],
        }),
        select: { professionalId: true },
      });
      expect(prismaMock.appointment.update).toHaveBeenCalled();
    });

    it.each([
      ["startAt", { startAt: new Date(startAt.getTime() + 3_600_000) }],
      ["serviceId", { serviceId: "service-2" }],
      ["clientId", { clientId: "client-2" }],
      ["professionalId", { professionalId: "professional-2" }],
    ])("não aceita mudar %s (400)", async (_, change) => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce(
        sessionAppointment,
      );

      await expect(
        appointmentService.update("appointment-1", change, COMPANY_ID),
      ).rejects.toThrow("Agendamento de turma não aceita");
      expect(prismaMock.appointment.update).not.toHaveBeenCalled();
    });

    it("cancelar o agendamento do aluno continua permitido (libera a vaga)", async () => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce(
        sessionAppointment,
      );
      prismaMock.appointment.update.mockResolvedValue({
        ...sessionAppointment,
        status: "CANCELLED",
      });

      await appointmentService.update(
        "appointment-1",
        { status: "CANCELLED" },
        COMPANY_ID,
      );

      expect(prismaMock.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "appointment-1", status: "SCHEDULED" },
        }),
      );
    });

    describe("createInClassSession", () => {
      const data = {
        companyId: COMPANY_ID,
        classSessionId: "session-1",
        clientId: "client-1",
        professionalId: "professional-1",
        serviceId: "service-1",
        startAt,
        endAt,
        overBooking: false,
      };

      it("confere a agenda sem os colegas da sessão e cria ligado a ela", async () => {
        await appointmentService.createInClassSession(
          prismaMock as never,
          data,
        );

        expect(prismaMock.appointment.findFirst).toHaveBeenCalledWith({
          where: containingWhere({
            OR: [professionalOutsideSession, { clientId: "client-1" }],
          }),
          select: { professionalId: true },
        });
        expect(prismaMock.appointment.create).toHaveBeenCalledWith({
          data: { ...data, note: null },
          include: relations,
        });
      });

      it("recusa quando o cliente já tem compromisso no horário (409)", async () => {
        prismaMock.appointment.findFirst.mockResolvedValue({
          professionalId: "professional-9",
        });

        await expect(
          appointmentService.createInClassSession(prismaMock as never, data),
        ).rejects.toThrow("O cliente já possui um agendamento neste horário");
        expect(prismaMock.appointment.create).not.toHaveBeenCalled();
      });

      it("recusa sessão que já começou (400)", async () => {
        await expect(
          appointmentService.createInClassSession(prismaMock as never, {
            ...data,
            startAt: new Date(Date.now() - 60_000),
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    it("attachToClassSession só liga o agendamento à sessão", async () => {
      await appointmentService.attachToClassSession(
        prismaMock as never,
        "appointment-1",
        "session-1",
      );

      expect(prismaMock.appointment.update).toHaveBeenCalledWith({
        where: { id: "appointment-1", classSessionId: null },
        data: { classSessionId: "session-1", updatedAt: anyDate },
      });
    });

    it("attachToClassSession recusa agendamento que outra conversão já ligou (409)", async () => {
      prismaMock.appointment.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Record not found", {
          code: "P2025",
          clientVersion: "test",
        }),
      );

      await expect(
        appointmentService.attachToClassSession(
          prismaMock as never,
          "appointment-1",
          "session-1",
        ),
      ).rejects.toThrow("O agendamento já pertence a uma turma");
    });
  });

  describe("recorrência na turma (createFromRecurrence com sessão)", () => {
    it("confere a agenda sem os colegas da sessão e grava a sessão em cada agendamento", async () => {
      prismaMock.appointment.createManyAndReturn.mockResolvedValue([]);

      await appointmentService.createFromRecurrence(
        prismaMock as never,
        {
          companyId: COMPANY_ID,
          recurringAppointmentId: "recurring-1",
          clientId: "client-1",
          professionalId: "professional-1",
          serviceId: "service-1",
        },
        [{ startAt, endAt, classSessionId: "session-1" }],
        "UTC",
      );

      expect(prismaMock.appointment.findFirst).toHaveBeenCalledWith({
        where: containingWhere({
          OR: [
            {
              professionalId: "professional-1",
              OR: [
                { classSessionId: null },
                { classSessionId: { not: "session-1" } },
              ],
            },
            { clientId: "client-1" },
          ],
        }),
        select: { professionalId: true },
      });
      expect(prismaMock.appointment.createManyAndReturn).toHaveBeenCalledWith({
        data: [
          containingWhere({
            recurringAppointmentId: "recurring-1",
            classSessionId: "session-1",
          }),
        ],
        select: { id: true, startAt: true },
      });
    });
  });
});
