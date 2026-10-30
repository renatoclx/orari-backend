import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { parseTimeOfDay } from "../../common/time/time-of-day";
import { PrismaService } from "../../prisma/prisma.service";
import { BusinessHourService } from "../business-hour/business-hour.service";
import { CompanyService } from "../company/company.service";
import { PeopleService } from "../people/people.service";
import { ServiceService } from "../service/service.service";
import { ClassGroupService } from "./class-group.service";
import { CreateClassGroupDto } from "./dto/create-class-group.dto";

const containing = (expected: object): unknown =>
  expect.objectContaining(expected);

describe("ClassGroupService", () => {
  let service: ClassGroupService;
  const prismaMock = {
    // Aceita as duas formas: lista de operações e função com o cliente da transação.
    $transaction: vi.fn(
      (operations: Promise<unknown>[] | ((tx: unknown) => unknown)) =>
        typeof operations === "function"
          ? operations(prismaMock)
          : Promise.all(operations),
    ),
    $queryRaw: vi.fn(),
    classGroup: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    classSession: { updateMany: vi.fn() },
    appointment: { groupBy: vi.fn() },
    recurringAppointment: { findMany: vi.fn() },
  };
  const serviceServiceMock = { findActive: vi.fn() };
  const peopleServiceMock = { findOne: vi.fn() };
  const businessHourServiceMock = {
    isWeeklySlotWithinBusinessHours: vi.fn(),
  };
  const companyServiceMock = { getTimeZone: vi.fn() };

  const dto: CreateClassGroupDto = {
    name: "Pilates Manhã",
    serviceId: "service-1",
    professionalId: "professional-1",
    capacity: 5,
    days: [
      { weekDay: "MONDAY", startTime: "08:00" },
      { weekDay: "WEDNESDAY", startTime: "08:00" },
    ],
  };

  // Como a turma volta do banco, com serviço, profissional e dias.
  const stored = {
    id: "class-1",
    companyId: COMPANY_ID,
    name: dto.name,
    serviceId: "service-1",
    professionalId: "professional-1",
    capacity: 5,
    isActive: true,
    createdAt: new Date(),
    updatedAt: null,
    service: { id: "service-1", name: "Pilates", color: null, duration: 50 },
    professional: { id: "professional-1", name: "Paula", photoUrl: null },
    days: [
      { weekDay: "MONDAY", startTime: parseTimeOfDay("08:00") },
      { weekDay: "WEDNESDAY", startTime: parseTimeOfDay("08:00") },
    ],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    serviceServiceMock.findActive.mockResolvedValue({
      id: "service-1",
      duration: 50,
      allowsClasses: true,
    });
    peopleServiceMock.findOne.mockResolvedValue({ type: "PROFESSIONAL" });
    businessHourServiceMock.isWeeklySlotWithinBusinessHours.mockResolvedValue(
      true,
    );
    companyServiceMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");
    prismaMock.classGroup.findMany.mockResolvedValue([]);
    // Padrão: a turma não tem sessões futuras (as vagas não esbarram em nada).
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.appointment.groupBy.mockResolvedValue([]);
    prismaMock.classGroup.create.mockResolvedValue(stored);
    prismaMock.classGroup.update.mockResolvedValue(stored);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassGroupService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ServiceService, useValue: serviceServiceMock },
        { provide: PeopleService, useValue: peopleServiceMock },
        { provide: BusinessHourService, useValue: businessHourServiceMock },
        { provide: CompanyService, useValue: companyServiceMock },
      ],
    }).compile();

    service = module.get<ClassGroupService>(ClassGroupService);
  });

  describe("create", () => {
    it("grava a turma na empresa, com o nome normalizado e os horários convertidos", async () => {
      await service.create(dto, COMPANY_ID);

      expect(prismaMock.classGroup.create).toHaveBeenCalledWith(
        containing({
          data: {
            name: "Pilates Manhã",
            normalizedName: "pilates manha",
            serviceId: "service-1",
            professionalId: "professional-1",
            capacity: 5,
            companyId: COMPANY_ID,
            days: {
              create: [
                { weekDay: "MONDAY", startTime: parseTimeOfDay("08:00") },
                { weekDay: "WEDNESDAY", startTime: parseTimeOfDay("08:00") },
              ],
            },
          },
        }),
      );
    });

    it("devolve os dias em HH:MM, com o fim calculado pela duração do serviço", async () => {
      const response = await service.create(dto, COMPANY_ID);

      expect(response.days).toEqual([
        { weekDay: "MONDAY", startTime: "08:00", endTime: "08:50" },
        { weekDay: "WEDNESDAY", startTime: "08:00", endTime: "08:50" },
      ]);
      expect(response).not.toHaveProperty("normalizedName");
    });

    it("sem nome, grava o nome normalizado vazio", async () => {
      await service.create({ ...dto, name: undefined }, COMPANY_ID);

      expect(prismaMock.classGroup.create).toHaveBeenCalledWith(
        containing({ data: containing({ normalizedName: null }) }),
      );
    });

    it("recusa serviço que não aceita turma (400)", async () => {
      serviceServiceMock.findActive.mockResolvedValue({
        duration: 50,
        allowsClasses: false,
      });

      await expect(service.create(dto, COMPANY_ID)).rejects.toThrow(
        "O serviço não aceita atendimento em turma",
      );
      expect(prismaMock.classGroup.create).not.toHaveBeenCalled();
    });

    it("recusa pessoa que não é profissional (400)", async () => {
      peopleServiceMock.findOne.mockResolvedValue({ type: "CLIENT" });

      await expect(service.create(dto, COMPANY_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prismaMock.classGroup.create).not.toHaveBeenCalled();
    });

    it("recusa dois horários sobrepostos no mesmo dia, considerando a duração", async () => {
      await expect(
        service.create(
          {
            ...dto,
            days: [
              { weekDay: "MONDAY", startTime: "08:00" },
              { weekDay: "MONDAY", startTime: "08:30" },
            ],
          },
          COMPANY_ID,
        ),
      ).rejects.toThrow("Há horários sobrepostos na segunda-feira");
    });

    it("aceita horários do mesmo dia que apenas se encostam", async () => {
      await service.create(
        {
          ...dto,
          days: [
            { weekDay: "MONDAY", startTime: "08:50" },
            { weekDay: "MONDAY", startTime: "08:00" },
          ],
        },
        COMPANY_ID,
      );

      expect(prismaMock.classGroup.create).toHaveBeenCalled();
    });

    it("confere cada horário no funcionamento e recusa o que não cabe (400)", async () => {
      businessHourServiceMock.isWeeklySlotWithinBusinessHours
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await expect(service.create(dto, COMPANY_ID)).rejects.toThrow(
        "O horário de quarta-feira às 08:00 está fora do funcionamento da empresa",
      );
      expect(
        businessHourServiceMock.isWeeklySlotWithinBusinessHours,
      ).toHaveBeenCalledWith(COMPANY_ID, "MONDAY", 480, 530);
      expect(prismaMock.classGroup.create).not.toHaveBeenCalled();
    });

    it("recusa quando o profissional já tem turma ativa no mesmo horário (409)", async () => {
      prismaMock.classGroup.findMany.mockResolvedValue([
        {
          name: "Pilates Cedo",
          service: { duration: 60 },
          days: [{ weekDay: "WEDNESDAY", startTime: parseTimeOfDay("07:30") }],
        },
      ]);

      await expect(service.create(dto, COMPANY_ID)).rejects.toThrow(
        'O profissional já tem a turma "Pilates Cedo" na quarta-feira às 08:00',
      );
      await expect(service.create(dto, COMPANY_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prismaMock.classGroup.findMany).toHaveBeenCalledWith(
        containing({
          where: { professionalId: "professional-1", isActive: true },
        }),
      );
      expect(prismaMock.classGroup.create).not.toHaveBeenCalled();
    });

    it("aceita turma do profissional que só encosta em outra", async () => {
      prismaMock.classGroup.findMany.mockResolvedValue([
        {
          name: null,
          service: { duration: 60 },
          days: [{ weekDay: "MONDAY", startTime: parseTimeOfDay("07:00") }],
        },
      ]);

      await service.create(dto, COMPANY_ID);

      expect(prismaMock.classGroup.create).toHaveBeenCalled();
    });
  });

  describe("findAll", () => {
    beforeEach(() => {
      prismaMock.classGroup.findMany.mockResolvedValue([stored]);
      prismaMock.classGroup.count.mockResolvedValue(1);
    });

    it("lista da empresa, da mais recente para a mais antiga, com os filtros", async () => {
      const result = await service.findAll(
        {
          page: 2,
          limit: 10,
          name: "PILATES",
          isActive: true,
          serviceId: "service-1",
          professionalId: "professional-1",
        },
        COMPANY_ID,
      );

      expect(prismaMock.classGroup.findMany).toHaveBeenCalledWith(
        containing({
          where: {
            companyId: COMPANY_ID,
            isActive: true,
            serviceId: "service-1",
            professionalId: "professional-1",
            normalizedName: { contains: "pilates" },
            createdAt: undefined,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: 10,
          take: 10,
        }),
      );
      expect(result.total).toBe(1);
      expect(result.items[0].days[0]).toEqual({
        weekDay: "MONDAY",
        startTime: "08:00",
        endTime: "08:50",
      });
      // Sem período, nem consulta o fuso.
      expect(companyServiceMock.getTimeZone).not.toHaveBeenCalled();
    });

    it("filtra a data de cadastro por dias inteiros no fuso da empresa", async () => {
      await service.findAll(
        {
          page: 1,
          limit: 10,
          from: new Date("2026-10-01"),
          to: new Date("2026-10-31"),
        },
        COMPANY_ID,
      );

      // São Paulo é UTC-3: o dia começa às 03:00 UTC; o fim é o início do dia seguinte.
      expect(prismaMock.classGroup.findMany).toHaveBeenCalledWith(
        containing({
          where: containing({
            createdAt: {
              gte: new Date("2026-10-01T03:00:00.000Z"),
              lt: new Date("2026-11-01T03:00:00.000Z"),
            },
          }),
        }),
      );
    });

    it("com uma só ponta, o período fica aberto do outro lado", async () => {
      await service.findAll(
        { page: 1, limit: 10, from: new Date("2026-10-01") },
        COMPANY_ID,
      );

      expect(prismaMock.classGroup.count).toHaveBeenCalledWith({
        where: containing({
          createdAt: {
            gte: new Date("2026-10-01T03:00:00.000Z"),
            lt: undefined,
          },
        }),
      });
    });
  });

  describe("findOne", () => {
    it("turma de outra empresa ou inexistente responde 404", async () => {
      prismaMock.classGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne("class-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.classGroup.findFirst).toHaveBeenCalledWith(
        containing({ where: { id: "class-1", companyId: COMPANY_ID } }),
      );
    });
  });

  describe("findMembers (alunos fixos)", () => {
    const client = { id: "client-1", name: "Ana", photoUrl: null };
    const day = {
      weekDay: "MONDAY",
      startTime: new Date("1970-01-01T08:00:00.000Z"),
    };

    beforeEach(() => {
      prismaMock.classGroup.findFirst.mockResolvedValue(stored);
      // 30/10/2026 às 23:30 em São Paulo (já 31/10 em UTC): "hoje" é 30/10.
      vi.setSystemTime(new Date("2026-10-31T02:30:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("lista as recorrências ativas, sem saída e no período, com a origem", async () => {
      prismaMock.recurringAppointment.findMany.mockResolvedValue([
        {
          id: "recurring-1",
          client,
          clientPlan: { id: "plan-1", plan: { name: "Pilates 2x" } },
          days: [day],
        },
        { id: "recurring-2", client, clientPlan: null, days: [day] },
      ]);

      const members = await service.findMembers("class-1", COMPANY_ID);

      expect(prismaMock.recurringAppointment.findMany).toHaveBeenCalledWith(
        containing({
          where: {
            companyId: COMPANY_ID,
            classGroupId: "class-1",
            isActive: true,
            classLeftAt: null,
            OR: [
              { endDate: null },
              { endDate: { gte: new Date("2026-10-30T00:00:00.000Z") } },
            ],
          },
          orderBy: [{ client: { name: "asc" } }, { id: "asc" }],
        }),
      );
      expect(members).toEqual([
        {
          recurringAppointmentId: "recurring-1",
          client,
          origin: "PLAN",
          clientPlan: { id: "plan-1", planName: "Pilates 2x" },
          days: [{ weekDay: "MONDAY", startTime: "08:00" }],
        },
        {
          recurringAppointmentId: "recurring-2",
          client,
          origin: "RECURRENCE",
          clientPlan: null,
          days: [{ weekDay: "MONDAY", startTime: "08:00" }],
        },
      ]);
    });

    it("turma de outra empresa responde 404", async () => {
      prismaMock.classGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.findMembers("class-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.recurringAppointment.findMany).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    describe("vagas da turma e das sessões futuras", () => {
      beforeEach(() => {
        prismaMock.classGroup.findFirst.mockResolvedValue(stored);
        prismaMock.$queryRaw.mockResolvedValue([
          { id: "session-1", startAt: new Date("2026-11-02T11:00:00Z") },
          { id: "session-2", startAt: new Date("2026-11-09T11:00:00Z") },
        ]);
      });

      it("aplica as novas vagas às sessões futuras, travadas", async () => {
        prismaMock.appointment.groupBy.mockResolvedValue([
          { classSessionId: "session-1", _count: { _all: 3 } },
        ]);

        await service.update("class-1", { capacity: 3 }, COMPANY_ID);

        const sql = (
          prismaMock.$queryRaw.mock.calls[0][0] as TemplateStringsArray
        ).join("?");
        expect(sql).toContain('"startAt" >');
        expect(sql).toContain('"cancelledAt" IS NULL');
        expect(sql).toContain("FOR UPDATE");
        expect(prismaMock.classSession.updateMany).toHaveBeenCalledWith({
          where: { id: { in: ["session-1", "session-2"] } },
          data: { capacity: 3, updatedAt: expect.any(Date) as unknown },
        });
        expect(prismaMock.classGroup.update).toHaveBeenCalled();
      });

      it("recusa vagas abaixo dos alunos de uma sessão futura (409), citando a data", async () => {
        prismaMock.appointment.groupBy.mockResolvedValue([
          { classSessionId: "session-2", _count: { _all: 4 } },
        ]);

        await expect(
          service.update("class-1", { capacity: 3 }, COMPANY_ID),
        ).rejects.toThrow(
          "A sessão de 09/11/2026 às 08:00 já tem 4 alunos: as vagas não podem ficar abaixo disso",
        );
        expect(prismaMock.classSession.updateMany).not.toHaveBeenCalled();
        expect(prismaMock.classGroup.update).not.toHaveBeenCalled();
      });

      it("sem mudar as vagas, não consulta as sessões", async () => {
        await service.update("class-1", { capacity: 5 }, COMPANY_ID);
        await service.update("class-1", { name: "Outro" }, COMPANY_ID);

        expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
      });
    });

    it("altera nome e vagas, mantendo a busca em sincronia", async () => {
      prismaMock.classGroup.findFirst.mockResolvedValue(stored);

      await service.update(
        "class-1",
        { name: "Pilates Tarde", capacity: 8 },
        COMPANY_ID,
      );

      expect(prismaMock.classGroup.update).toHaveBeenCalledWith(
        containing({
          where: { id: "class-1" },
          data: {
            name: "Pilates Tarde",
            capacity: 8,
            normalizedName: "pilates tarde",
            updatedAt: expect.any(Date) as unknown,
          },
        }),
      );
    });

    it("null remove o nome e a busca", async () => {
      prismaMock.classGroup.findFirst.mockResolvedValue(stored);

      await service.update("class-1", { name: null }, COMPANY_ID);

      expect(prismaMock.classGroup.update).toHaveBeenCalledWith(
        containing({
          data: containing({ name: null, normalizedName: null }),
        }),
      );
    });

    it("inativar não confere serviço nem horários", async () => {
      prismaMock.classGroup.findFirst.mockResolvedValue(stored);

      await service.update("class-1", { isActive: false }, COMPANY_ID);

      expect(serviceServiceMock.findActive).not.toHaveBeenCalled();
      expect(prismaMock.classGroup.update).toHaveBeenCalled();
    });

    describe("reativar", () => {
      beforeEach(() => {
        prismaMock.classGroup.findFirst.mockResolvedValue({
          ...stored,
          isActive: false,
        });
      });

      it("confere de novo e ignora a própria turma na conferência do profissional", async () => {
        await service.update("class-1", { isActive: true }, COMPANY_ID);

        expect(serviceServiceMock.findActive).toHaveBeenCalledWith(
          "service-1",
          COMPANY_ID,
        );
        expect(
          businessHourServiceMock.isWeeklySlotWithinBusinessHours,
        ).toHaveBeenCalledTimes(2);
        expect(prismaMock.classGroup.findMany).toHaveBeenCalledWith(
          containing({
            where: {
              professionalId: "professional-1",
              isActive: true,
              id: { not: "class-1" },
            },
          }),
        );
        expect(prismaMock.classGroup.update).toHaveBeenCalled();
      });

      it("recusa se o serviço deixou de aceitar turma", async () => {
        serviceServiceMock.findActive.mockResolvedValue({
          duration: 50,
          allowsClasses: false,
        });

        await expect(
          service.update("class-1", { isActive: true }, COMPANY_ID),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prismaMock.classGroup.update).not.toHaveBeenCalled();
      });

      it("recusa se outra turma ativa do profissional ocupou o horário", async () => {
        prismaMock.classGroup.findMany.mockResolvedValue([
          {
            name: null,
            service: { duration: 50 },
            days: [{ weekDay: "MONDAY", startTime: parseTimeOfDay("08:00") }],
          },
        ]);

        await expect(
          service.update("class-1", { isActive: true }, COMPANY_ID),
        ).rejects.toThrow(
          "O profissional já tem outra turma na segunda-feira às 08:00",
        );
        expect(prismaMock.classGroup.update).not.toHaveBeenCalled();
      });
    });
  });
});
