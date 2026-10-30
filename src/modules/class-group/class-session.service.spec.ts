import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { parseTimeOfDay } from "../../common/time/time-of-day";
import { PrismaService } from "../../prisma/prisma.service";
import { AppointmentService } from "../appointment/appointment.service";
import { BusinessHourService } from "../business-hour/business-hour.service";
import { CompanyService } from "../company/company.service";
import { PaymentService } from "../payment/payment.service";
import { PeopleService } from "../people/people.service";
import { ServiceService } from "../service/service.service";
import { ClassSessionService } from "./class-session.service";

const containing = (expected: object): unknown =>
  expect.objectContaining(expected);

// Próxima segunda-feira às 08:00 em São Paulo (11:00 UTC), sempre no futuro.
function nextMondayAt8(): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  while (date.getUTCDay() !== 1) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  date.setUTCHours(11, 0, 0, 0);
  return date;
}

describe("ClassSessionService", () => {
  let service: ClassSessionService;
  // Cliente da transação: a trava e as contagens acontecem nele.
  const txMock = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    appointment: { count: vi.fn(), findFirst: vi.fn() },
    classSession: { create: vi.fn(), update: vi.fn() },
  };
  const prismaMock = {
    $transaction: vi.fn((fn: (tx: typeof txMock) => unknown) => fn(txMock)),
    classGroup: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
    classSession: { findFirst: vi.fn() },
  };
  const appointmentServiceMock = {
    findOne: vi.fn(),
    createInClassSession: vi.fn(),
    attachToClassSession: vi.fn(),
    cancelForClassSession: vi.fn(),
  };
  const paymentServiceMock = { cancelPendingForClassSession: vi.fn() };
  const serviceServiceMock = { findActive: vi.fn() };
  const peopleServiceMock = { findOne: vi.fn() };
  const businessHourServiceMock = { ensureWithinBusinessHours: vi.fn() };
  const companyServiceMock = { getTimeZone: vi.fn() };

  const startAt = nextMondayAt8();
  const endAt = new Date(startAt.getTime() + 50 * 60_000);
  const classGroup = {
    id: "group-1",
    companyId: COMPANY_ID,
    serviceId: "service-1",
    professionalId: "professional-1",
    capacity: 3,
    isActive: true,
    days: [{ weekDay: "MONDAY", startTime: parseTimeOfDay("08:00") }],
  };
  const session = {
    id: "session-1",
    companyId: COMPANY_ID,
    classGroupId: "group-1",
    serviceId: "service-1",
    professionalId: "professional-1",
    startAt,
    endAt,
    capacity: 3,
    overBooking: false,
    cancelledAt: null,
  };
  const locked = { id: "session-1", capacity: 3, cancelledAt: null };

  beforeEach(async () => {
    vi.clearAllMocks();
    serviceServiceMock.findActive.mockResolvedValue({
      duration: 50,
      allowsClasses: true,
    });
    peopleServiceMock.findOne.mockResolvedValue({ type: "CLIENT" });
    companyServiceMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");
    prismaMock.classGroup.findFirst.mockResolvedValue(classGroup);
    prismaMock.classGroup.findUniqueOrThrow.mockResolvedValue({
      isActive: true,
    });
    prismaMock.classSession.findFirst.mockResolvedValue(session);
    txMock.$queryRaw.mockResolvedValue([locked]);
    txMock.appointment.count.mockResolvedValue(1);
    txMock.appointment.findFirst.mockResolvedValue(null);
    txMock.classSession.create.mockResolvedValue({ id: "session-2" });
    appointmentServiceMock.createInClassSession.mockResolvedValue({
      id: "appointment-9",
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassSessionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AppointmentService, useValue: appointmentServiceMock },
        { provide: ServiceService, useValue: serviceServiceMock },
        { provide: PeopleService, useValue: peopleServiceMock },
        { provide: BusinessHourService, useValue: businessHourServiceMock },
        { provide: CompanyService, useValue: companyServiceMock },
        { provide: PaymentService, useValue: paymentServiceMock },
      ],
    }).compile();

    service = module.get<ClassSessionService>(ClassSessionService);
  });

  describe("enrollInClassGroup (encaixe avulso na turma fixa)", () => {
    const dto = { clientId: "client-1", startAt, note: "primeira aula" };

    it("cria a sessão do horário se faltar, trava e encaixa o aluno", async () => {
      await service.enrollInClassGroup("group-1", dto, COMPANY_ID);

      // O INSERT ... ON CONFLICT DO NOTHING leva a turma, o horário e as vagas dela.
      const insertValues = txMock.$executeRaw.mock.calls[0].slice(1);
      expect(insertValues).toEqual(
        expect.arrayContaining(["group-1", startAt, endAt, 3]),
      );
      const lockSql = (
        txMock.$queryRaw.mock.calls[0][0] as TemplateStringsArray
      ).join("?");
      expect(lockSql).toContain("FOR UPDATE");
      expect(
        businessHourServiceMock.ensureWithinBusinessHours,
      ).toHaveBeenCalledWith(COMPANY_ID, startAt, endAt);
      expect(appointmentServiceMock.createInClassSession).toHaveBeenCalledWith(
        txMock,
        {
          companyId: COMPANY_ID,
          classSessionId: "session-1",
          clientId: "client-1",
          professionalId: "professional-1",
          serviceId: "service-1",
          startAt,
          endAt,
          overBooking: false,
          note: "primeira aula",
        },
      );
    });

    it("recusa horário que não é da turma (400)", async () => {
      await expect(
        service.enrollInClassGroup(
          "group-1",
          { ...dto, startAt: new Date(startAt.getTime() + 30 * 60_000) },
          COMPANY_ID,
        ),
      ).rejects.toThrow("A turma não tem horário em");
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("recusa turma inativa (409) e turma de outra empresa (404)", async () => {
      prismaMock.classGroup.findFirst.mockResolvedValueOnce({
        ...classGroup,
        isActive: false,
      });
      await expect(
        service.enrollInClassGroup("group-1", dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);

      prismaMock.classGroup.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.enrollInClassGroup("group-1", dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("recusa sessão que já começou (400)", async () => {
      await expect(
        service.enrollInClassGroup(
          "group-1",
          { ...dto, startAt: new Date(Date.now() - 60_000) },
          COMPANY_ID,
        ),
      ).rejects.toThrow("A sessão já começou");
    });

    it("recusa quem não é cliente (400)", async () => {
      peopleServiceMock.findOne.mockResolvedValue({ type: "PROFESSIONAL" });

      await expect(
        service.enrollInClassGroup("group-1", dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("enroll (sessão que já existe)", () => {
    it("conta a vaga com a sessão travada, sem os cancelados", async () => {
      await service.enroll("session-1", { clientId: "client-1" }, COMPANY_ID);

      expect(txMock.appointment.count).toHaveBeenCalledWith({
        where: {
          classSessionId: "session-1",
          status: { not: "CANCELLED" },
        },
      });
      expect(appointmentServiceMock.createInClassSession).toHaveBeenCalled();
    });

    it("recusa a sessão cheia (409)", async () => {
      txMock.appointment.count.mockResolvedValue(3);

      await expect(
        service.enroll("session-1", { clientId: "client-1" }, COMPANY_ID),
      ).rejects.toThrow("A sessão está cheia (3 vagas)");
      expect(
        appointmentServiceMock.createInClassSession,
      ).not.toHaveBeenCalled();
    });

    it("recusa o cliente que já está na sessão (409)", async () => {
      txMock.appointment.findFirst.mockResolvedValue({ id: "appointment-1" });

      await expect(
        service.enroll("session-1", { clientId: "client-1" }, COMPANY_ID),
      ).rejects.toThrow("O cliente já está nesta sessão");
    });

    it("recusa a sessão cancelada (409)", async () => {
      txMock.$queryRaw.mockResolvedValue([
        { ...locked, cancelledAt: new Date() },
      ]);

      await expect(
        service.enroll("session-1", { clientId: "client-1" }, COMPANY_ID),
      ).rejects.toThrow("A sessão da turma foi cancelada");
    });

    it("recusa sessão de turma fixa inativa (409)", async () => {
      prismaMock.classGroup.findUniqueOrThrow.mockResolvedValue({
        isActive: false,
      });

      await expect(
        service.enroll("session-1", { clientId: "client-1" }, COMPANY_ID),
      ).rejects.toThrow("A turma está inativa");
    });

    it("na sessão avulsa, o aluno herda o encaixe do agendamento original", async () => {
      prismaMock.classSession.findFirst.mockResolvedValue({
        ...session,
        classGroupId: null,
        overBooking: true,
      });

      await service.enroll("session-1", { clientId: "client-1" }, COMPANY_ID);

      expect(prismaMock.classGroup.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(appointmentServiceMock.createInClassSession).toHaveBeenCalledWith(
        txMock,
        containing({ overBooking: true }),
      );
    });

    it("sessão de outra empresa responde 404", async () => {
      prismaMock.classSession.findFirst.mockResolvedValue(null);

      await expect(
        service.enroll("session-1", { clientId: "client-1" }, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("create (agendamento que vira turma)", () => {
    const appointment = {
      id: "appointment-1",
      status: "SCHEDULED",
      classSessionId: null,
      serviceId: "service-1",
      professionalId: "professional-1",
      startAt,
      endAt,
      overBooking: true,
    };

    beforeEach(() => {
      appointmentServiceMock.findOne.mockResolvedValue(appointment);
      prismaMock.classSession.findFirst.mockResolvedValue({
        ...session,
        id: "session-2",
        appointments: [],
      });
    });

    it("cria a sessão avulsa com os dados do agendamento e liga o agendamento", async () => {
      await service.create(
        { appointmentId: "appointment-1", capacity: 4 },
        COMPANY_ID,
      );

      expect(txMock.classSession.create).toHaveBeenCalledWith({
        data: {
          companyId: COMPANY_ID,
          serviceId: "service-1",
          professionalId: "professional-1",
          startAt,
          endAt,
          capacity: 4,
          overBooking: true,
        },
        select: { id: true },
      });
      expect(appointmentServiceMock.attachToClassSession).toHaveBeenCalledWith(
        txMock,
        "appointment-1",
        "session-2",
      );
    });

    it.each([
      ["já é de uma turma", { classSessionId: "session-1" }, ConflictException],
      ["está concluído", { status: "COMPLETED" }, BadRequestException],
      [
        "já começou",
        { startAt: new Date(Date.now() - 60_000) },
        BadRequestException,
      ],
    ])("recusa o agendamento que %s", async (_, change, error) => {
      appointmentServiceMock.findOne.mockResolvedValue({
        ...appointment,
        ...change,
      });

      await expect(
        service.create(
          { appointmentId: "appointment-1", capacity: 4 },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(error);
      expect(txMock.classSession.create).not.toHaveBeenCalled();
    });

    it("recusa serviço que não aceita turma (400)", async () => {
      serviceServiceMock.findActive.mockResolvedValue({
        duration: 50,
        allowsClasses: false,
      });

      await expect(
        service.create(
          { appointmentId: "appointment-1", capacity: 4 },
          COMPANY_ID,
        ),
      ).rejects.toThrow("O serviço não aceita atendimento em turma");
    });
  });

  describe("findOne", () => {
    it("informa as vagas ocupadas (sem os cancelados) e as livres", async () => {
      prismaMock.classSession.findFirst.mockResolvedValue({
        ...session,
        appointments: [
          { id: "a", status: "SCHEDULED" },
          { id: "b", status: "NO_SHOW" },
          { id: "c", status: "CANCELLED" },
        ],
      });

      const result = await service.findOne("session-1", COMPANY_ID);

      expect(result.occupied).toBe(2);
      expect(result.available).toBe(1);
    });
  });

  describe("update (vagas da sessão)", () => {
    beforeEach(() => {
      prismaMock.classSession.findFirst.mockResolvedValue({
        ...session,
        appointments: [],
      });
    });

    it("altera as vagas com a sessão travada", async () => {
      txMock.appointment.count.mockResolvedValue(2);

      await service.update("session-1", { capacity: 2 }, COMPANY_ID);

      expect(txMock.classSession.update).toHaveBeenCalledWith({
        where: { id: "session-1" },
        data: { capacity: 2, updatedAt: expect.any(Date) as unknown },
      });
    });

    it("recusa vagas abaixo do número de alunos (409)", async () => {
      txMock.appointment.count.mockResolvedValue(3);

      await expect(
        service.update("session-1", { capacity: 2 }, COMPANY_ID),
      ).rejects.toThrow("A sessão já tem 3 alunos");
      expect(txMock.classSession.update).not.toHaveBeenCalled();
    });

    it("recusa sessão que já começou (400)", async () => {
      prismaMock.classSession.findFirst.mockResolvedValue({
        ...session,
        startAt: new Date(Date.now() - 60_000),
      });

      await expect(
        service.update("session-1", { capacity: 4 }, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("cancel (sessão inteira)", () => {
    beforeEach(() => {
      prismaMock.classSession.findFirst.mockResolvedValue({
        ...session,
        appointments: [],
      });
    });

    it("com a sessão travada, grava o cancelamento e cancela agendamentos e pagamentos pendentes", async () => {
      await service.cancel("session-1", { note: "Feriado" }, COMPANY_ID);

      const lockSql = (
        txMock.$queryRaw.mock.calls[0][0] as TemplateStringsArray
      ).join("?");
      expect(lockSql).toContain("FOR UPDATE");
      expect(txMock.classSession.update).toHaveBeenCalledWith({
        where: { id: "session-1" },
        data: {
          cancelledAt: expect.any(Date) as unknown,
          cancellationNote: "Feriado",
          updatedAt: expect.any(Date) as unknown,
        },
      });
      expect(appointmentServiceMock.cancelForClassSession).toHaveBeenCalledWith(
        txMock,
        "session-1",
      );
      expect(
        paymentServiceMock.cancelPendingForClassSession,
      ).toHaveBeenCalledWith(txMock, "session-1");
    });

    it("sem motivo, grava a observação vazia", async () => {
      await service.cancel("session-1", {}, COMPANY_ID);

      expect(txMock.classSession.update).toHaveBeenCalledWith(
        containing({ data: containing({ cancellationNote: null }) }),
      );
    });

    it("recusa a sessão que já começou (400)", async () => {
      prismaMock.classSession.findFirst.mockResolvedValue({
        ...session,
        startAt: new Date(Date.now() - 60_000),
      });

      await expect(service.cancel("session-1", {}, COMPANY_ID)).rejects.toThrow(
        "A sessão já começou: não pode ser cancelada",
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("recusa a sessão já cancelada (409)", async () => {
      txMock.$queryRaw.mockResolvedValueOnce([
        { ...locked, cancelledAt: new Date() },
      ]);

      await expect(
        service.cancel("session-1", {}, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        appointmentServiceMock.cancelForClassSession,
      ).not.toHaveBeenCalled();
    });

    it("sessão de outra empresa responde 404", async () => {
      prismaMock.classSession.findFirst.mockResolvedValue(null);

      await expect(
        service.cancel("session-1", {}, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("reposição numa turma fixa", () => {
    const resolve = (overrides: { serviceId?: string; startAt?: Date } = {}) =>
      service.resolveClassGroupSlot(
        "group-1",
        { serviceId: "service-1", startAt, ...overrides },
        COMPANY_ID,
        "America/Sao_Paulo",
      );

    it("valida a turma e o horário e devolve a vaga a reservar", async () => {
      const slot = await resolve();

      expect(slot).toEqual({ classGroup, startAt, endAt });
      expect(
        businessHourServiceMock.ensureWithinBusinessHours,
      ).toHaveBeenCalledWith(COMPANY_ID, startAt, endAt);
    });

    it("recusa turma de outro serviço (400)", async () => {
      await expect(resolve({ serviceId: "service-2" })).rejects.toThrow(
        "A turma precisa ser do mesmo serviço da aula",
      );
    });

    it("recusa horário que não é da turma (400)", async () => {
      await expect(
        resolve({ startAt: new Date(startAt.getTime() + 3_600_000) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("recusa turma inativa (409) e de outra empresa (404)", async () => {
      prismaMock.classGroup.findFirst.mockResolvedValueOnce({
        ...classGroup,
        isActive: false,
      });
      await expect(resolve()).rejects.toBeInstanceOf(ConflictException);

      prismaMock.classGroup.findFirst.mockResolvedValueOnce(null);
      await expect(resolve()).rejects.toBeInstanceOf(NotFoundException);
    });

    it("reserva a vaga com a sessão travada e devolve o profissional da turma", async () => {
      await expect(
        service.reserveSeat(
          txMock as never,
          { classGroup, startAt, endAt },
          "client-1",
        ),
      ).resolves.toEqual({ id: "session-1", professionalId: "professional-1" });
      expect(txMock.$executeRaw).toHaveBeenCalled();
    });

    it.each([
      ["cheia", () => txMock.appointment.count.mockResolvedValueOnce(3)],
      [
        "com o cliente já nela",
        () => txMock.appointment.findFirst.mockResolvedValueOnce({ id: "x" }),
      ],
      [
        "cancelada",
        () =>
          txMock.$queryRaw.mockResolvedValueOnce([
            { ...locked, cancelledAt: new Date() },
          ]),
      ],
    ])("recusa a sessão %s (409)", async (_, arrange) => {
      arrange();

      await expect(
        service.reserveSeat(
          txMock as never,
          { classGroup, startAt, endAt },
          "client-1",
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("recorrência e plano na turma", () => {
    describe("ensureRecurrenceFitsClassGroup", () => {
      const recurrence = {
        serviceId: "service-1",
        professionalId: "professional-1",
        days: [{ weekDay: "MONDAY" as const, startTime: "08:00" }],
      };

      it("aceita dias que são horários da turma", async () => {
        await expect(
          service.ensureRecurrenceFitsClassGroup(
            "group-1",
            recurrence,
            COMPANY_ID,
          ),
        ).resolves.toBeUndefined();
        expect(prismaMock.classGroup.findFirst).toHaveBeenCalledWith(
          containing({ where: { id: "group-1", companyId: COMPANY_ID } }),
        );
      });

      it.each([
        [
          "dia que não é da turma",
          { days: [{ weekDay: "TUESDAY" as const, startTime: "08:00" }] },
          "A turma não tem horário na terça-feira às 08:00",
        ],
        [
          "início diferente do da turma",
          { days: [{ weekDay: "MONDAY" as const, startTime: "08:30" }] },
          "A turma não tem horário na segunda-feira às 08:30",
        ],
        [
          "serviço diferente do da turma",
          { serviceId: "service-2" },
          "serviceId e professionalId devem ser os da turma",
        ],
        [
          "profissional diferente do da turma",
          { professionalId: "professional-2" },
          "serviceId e professionalId devem ser os da turma",
        ],
      ])("recusa %s (400)", async (_, change, message) => {
        await expect(
          service.ensureRecurrenceFitsClassGroup(
            "group-1",
            { ...recurrence, ...change },
            COMPANY_ID,
          ),
        ).rejects.toThrow(message);
      });

      it("recusa turma inativa (409) e de outra empresa (404)", async () => {
        prismaMock.classGroup.findFirst.mockResolvedValueOnce({
          ...classGroup,
          isActive: false,
        });
        await expect(
          service.ensureRecurrenceFitsClassGroup(
            "group-1",
            recurrence,
            COMPANY_ID,
          ),
        ).rejects.toBeInstanceOf(ConflictException);

        prismaMock.classGroup.findFirst.mockResolvedValueOnce(null);
        await expect(
          service.ensureRecurrenceFitsClassGroup(
            "group-1",
            recurrence,
            COMPANY_ID,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
      });
    });

    describe("reserveForOccurrences", () => {
      const occurrences = [
        { startAt, endAt },
        {
          startAt: new Date(startAt.getTime() + 7 * 86_400_000),
          endAt: new Date(endAt.getTime() + 7 * 86_400_000),
        },
      ];

      beforeEach(() => {
        (txMock as Record<string, unknown>).classGroup = {
          findUniqueOrThrow: vi.fn().mockResolvedValue(classGroup),
        };
      });

      it("trava a sessão de cada horário e devolve as ocorrências com a sessão", async () => {
        txMock.$queryRaw
          .mockResolvedValueOnce([locked])
          .mockResolvedValueOnce([{ ...locked, id: "session-2" }]);

        const result = await service.reserveForOccurrences(
          txMock as never,
          "group-1",
          occurrences,
          "America/Sao_Paulo",
        );

        expect(txMock.$executeRaw).toHaveBeenCalledTimes(2);
        expect(result.map((item) => item.classSessionId)).toEqual([
          "session-1",
          "session-2",
        ]);
      });

      it("sem vaga em uma data, recusa citando a data (409)", async () => {
        txMock.appointment.count
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(3);

        await expect(
          service.reserveForOccurrences(
            txMock as never,
            "group-1",
            occurrences,
            "America/Sao_Paulo",
          ),
        ).rejects.toThrow(
          /^Sem vaga na turma em \d{2}\/\d{2}\/\d{4} às 08:00$/,
        );
      });

      it("sessão cancelada em uma data, recusa (409)", async () => {
        txMock.$queryRaw.mockResolvedValueOnce([
          { ...locked, cancelledAt: new Date() },
        ]);

        await expect(
          service.reserveForOccurrences(
            txMock as never,
            "group-1",
            occurrences,
            "America/Sao_Paulo",
          ),
        ).rejects.toThrow("foi cancelada");
      });
    });
  });
});
