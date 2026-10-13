import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { PaymentService } from "../payment/payment.service";
import { PlanService } from "../plan/plan.service";
import { RecurringAppointmentService } from "../recurring-appointment/recurring-appointment.service";
import { ClientPlanService } from "./client-plan.service";
import { CreateClientPlanDto } from "./dto/create-client-plan.dto";

const anyDate: unknown = expect.any(Date);

describe("ClientPlanService", () => {
  let clientPlanService: ClientPlanService;
  const prismaMock = {
    // Suporta a transação interativa (com opções) e a lista de operações.
    $transaction: vi.fn(
      (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
        typeof arg === "function" ? arg(prismaMock) : Promise.all(arg),
    ),
    clientPlan: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
  const planServiceMock = { findOne: vi.fn() };
  const companyServiceMock = { getTimeZone: vi.fn() };
  const recurringServiceMock = {
    createForClientPlan: vi.fn(),
    endForClientPlan: vi.fn(),
  };
  const paymentServiceMock = {
    createForClientPlan: vi.fn(),
    cancelUpcomingForClientPlan: vi.fn(),
  };

  // Como o PlanService devolve: valores Decimal e serviços com isActive.
  const plan = {
    id: "plan-1",
    isActive: true,
    monthlyPrice: new Decimal(400),
    services: [
      { id: "service-1", name: "Fisioterapia", isActive: true },
      { id: "service-2", name: "Pilates", isActive: true },
    ],
    periods: [
      {
        months: 3,
        discountPercent: new Decimal(10),
        monthlyDiscountPercent: new Decimal(5),
      },
    ],
  };

  const days = [
    { weekDay: "TUESDAY" as const, startTime: "10:00", endTime: "11:00" },
  ];
  const dto: CreateClientPlanDto = {
    clientId: "client-1",
    planId: "plan-1",
    months: 3,
    billingType: "MONTHLY",
    schedules: [
      { serviceId: "service-1", professionalId: "professional-1", days },
      { serviceId: "service-2", professionalId: "professional-2", days },
    ],
  };

  // Valores repassados ao PaymentService, como texto para comparar.
  const charges = () =>
    (
      paymentServiceMock.createForClientPlan.mock.calls[0][3] as {
        amount: Decimal;
        dueDate: Date | null;
      }[]
    ).map(({ amount, dueDate }) => ({
      amount: amount.toFixed(2),
      dueDate: dueDate?.toISOString().slice(0, 10) ?? null,
    }));

  beforeEach(async () => {
    vi.clearAllMocks();
    // "Hoje" fixo: 2026-10-09 às 12h UTC (9h em São Paulo).
    vi.setSystemTime(new Date("2026-10-09T12:00:00.000Z"));
    planServiceMock.findOne.mockResolvedValue(plan);
    companyServiceMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");
    prismaMock.clientPlan.create.mockResolvedValue({ id: "client-plan-1" });
    prismaMock.clientPlan.findFirst.mockResolvedValue({ id: "client-plan-1" });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientPlanService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PlanService, useValue: planServiceMock },
        { provide: CompanyService, useValue: companyServiceMock },
        {
          provide: RecurringAppointmentService,
          useValue: recurringServiceMock,
        },
        { provide: PaymentService, useValue: paymentServiceMock },
      ],
    }).compile();

    clientPlanService = module.get<ClientPlanService>(ClientPlanService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("create: valores e período", () => {
    it("deve gravar a contratação com os valores congelados do mensal", async () => {
      await clientPlanService.create(dto, COMPANY_ID);

      const { data } = prismaMock.clientPlan.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data).toMatchObject({
        companyId: COMPANY_ID,
        clientId: "client-1",
        planId: "plan-1",
        billingType: "MONTHLY",
        months: 3,
        startDate: new Date("2026-10-09"),
        endDate: new Date("2027-01-08"),
        firstDueDate: null,
      });
      expect(String(data.monthlyAmount)).toBe("400");
      expect(String(data.discountPercent)).toBe("5");
      expect(String(data.totalAmount)).toBe("1140");
    });

    it("mensal: uma parcela por mês, com vencimentos a partir do primeiro", async () => {
      await clientPlanService.create(
        { ...dto, firstDueDate: new Date("2026-10-31") },
        COMPANY_ID,
      );

      expect(paymentServiceMock.createForClientPlan).toHaveBeenCalledWith(
        prismaMock,
        COMPANY_ID,
        "client-plan-1",
        expect.any(Array),
      );
      expect(charges()).toEqual([
        { amount: "380.00", dueDate: "2026-10-31" },
        { amount: "380.00", dueDate: "2026-11-30" },
        { amount: "380.00", dueDate: "2026-12-31" },
      ]);
    });

    it("integral: um único pagamento com o total e o desconto integral", async () => {
      await clientPlanService.create(
        { ...dto, billingType: "INTEGRAL" },
        COMPANY_ID,
      );

      expect(charges()).toEqual([{ amount: "1080.00", dueDate: null }]);
    });

    it("deve aceitar data de início futura", async () => {
      await clientPlanService.create(
        { ...dto, startDate: new Date("2026-10-15") },
        COMPANY_ID,
      );

      expect(prismaMock.clientPlan.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startDate: new Date("2026-10-15"),
          endDate: new Date("2027-01-14"),
        }) as unknown,
      });
    });

    it("deve considerar 'hoje' no fuso da empresa", async () => {
      // 01:00 UTC de 10/10 ainda é 09/10 em São Paulo.
      vi.setSystemTime(new Date("2026-10-10T01:00:00.000Z"));

      await clientPlanService.create(dto, COMPANY_ID);

      expect(prismaMock.clientPlan.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startDate: new Date("2026-10-09"),
        }) as unknown,
      });
    });

    it("deve recusar data de início passada sem gravar", async () => {
      await expect(
        clientPlanService.create(
          { ...dto, startDate: new Date("2026-10-08") },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("create: agendas", () => {
    it("deve criar uma recorrência por serviço com o período da contratação", async () => {
      await clientPlanService.create(dto, COMPANY_ID);

      expect(recurringServiceMock.createForClientPlan).toHaveBeenCalledTimes(2);
      expect(recurringServiceMock.createForClientPlan).toHaveBeenCalledWith(
        prismaMock,
        {
          serviceId: "service-2",
          professionalId: "professional-2",
          days,
          clientPlanId: "client-plan-1",
          clientId: "client-1",
          startDate: new Date("2026-10-09"),
          endDate: new Date("2027-01-08"),
        },
        COMPANY_ID,
        "America/Sao_Paulo",
      );
    });

    it("deve usar uma transação com tempo limite maior", async () => {
      await clientPlanService.create(dto, COMPANY_ID);

      expect(prismaMock.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { timeout: 30_000 },
      );
    });

    it("deve propagar o conflito de agenda (a transação desfaz tudo)", async () => {
      recurringServiceMock.createForClientPlan.mockRejectedValueOnce(
        new ConflictException("O cliente já possui um agendamento"),
      );

      await expect(
        clientPlanService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(paymentServiceMock.createForClientPlan).not.toHaveBeenCalled();
    });

    it.each([
      {
        caso: "falta um serviço",
        schedules: [{ serviceId: "service-1", professionalId: "p", days }],
      },
      {
        caso: "serviço fora do plano",
        schedules: [
          { serviceId: "service-1", professionalId: "p", days },
          { serviceId: "service-2", professionalId: "p", days },
          { serviceId: "service-9", professionalId: "p", days },
        ],
      },
      {
        caso: "serviço repetido",
        schedules: [
          { serviceId: "service-1", professionalId: "p", days },
          { serviceId: "service-1", professionalId: "p", days },
          { serviceId: "service-2", professionalId: "p", days },
        ],
      },
    ])(
      "deve recusar agendas que não cobrem o plano ($caso)",
      async ({ schedules }) => {
        await expect(
          clientPlanService.create({ ...dto, schedules }, COMPANY_ID),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
      },
    );
  });

  describe("create: plano", () => {
    it("deve recusar plano inativo", async () => {
      planServiceMock.findOne.mockResolvedValueOnce({
        ...plan,
        isActive: false,
      });

      await expect(
        clientPlanService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("deve recusar plano com serviço inativo", async () => {
      planServiceMock.findOne.mockResolvedValueOnce({
        ...plan,
        services: [plan.services[0], { ...plan.services[1], isActive: false }],
      });

      await expect(
        clientPlanService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("deve recusar período que o plano não tem (inclusive plano sem períodos)", async () => {
      await expect(
        clientPlanService.create({ ...dto, months: 6 }, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);

      planServiceMock.findOne.mockResolvedValueOnce({ ...plan, periods: [] });
      await expect(
        clientPlanService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("deve propagar o 404 de plano de outra empresa", async () => {
      planServiceMock.findOne.mockRejectedValueOnce(new NotFoundException());

      await expect(
        clientPlanService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("cancel", () => {
    // Contrato mensal ativo de 09/10/2026 a 08/01/2027; "hoje" é 09/10/2026.
    const active = {
      id: "client-plan-1",
      billingType: "MONTHLY",
      endDate: new Date("2027-01-08"),
      cancelledAt: null,
    };

    beforeEach(() => {
      prismaMock.clientPlan.findFirst.mockResolvedValue(active);
    });

    it("mensal: registra o cancelamento, encerra as agendas e cancela as parcelas a vencer", async () => {
      await clientPlanService.cancel("client-plan-1", COMPANY_ID);

      expect(prismaMock.clientPlan.update).toHaveBeenCalledWith({
        where: { id: "client-plan-1" },
        data: { cancelledAt: anyDate, updatedAt: anyDate },
      });
      expect(recurringServiceMock.endForClientPlan).toHaveBeenCalledWith(
        prismaMock,
        "client-plan-1",
        COMPANY_ID,
      );
      // A partir de hoje no fuso da empresa: as atrasadas ficam PENDING.
      expect(
        paymentServiceMock.cancelUpcomingForClientPlan,
      ).toHaveBeenCalledWith(
        prismaMock,
        "client-plan-1",
        new Date("2026-10-09"),
      );
    });

    it("integral: encerra as agendas sem mexer no pagamento", async () => {
      prismaMock.clientPlan.findFirst.mockResolvedValue({
        ...active,
        billingType: "INTEGRAL",
      });

      await clientPlanService.cancel("client-plan-1", COMPANY_ID);

      expect(recurringServiceMock.endForClientPlan).toHaveBeenCalled();
      expect(
        paymentServiceMock.cancelUpcomingForClientPlan,
      ).not.toHaveBeenCalled();
    });

    it("deve recusar cancelar de novo", async () => {
      prismaMock.clientPlan.findFirst.mockResolvedValue({
        ...active,
        cancelledAt: new Date("2026-10-08T15:00:00.000Z"),
      });

      await expect(
        clientPlanService.cancel("client-plan-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("deve recusar contratação cujo período já terminou", async () => {
      prismaMock.clientPlan.findFirst.mockResolvedValue({
        ...active,
        endDate: new Date("2026-10-08"),
      });

      await expect(
        clientPlanService.cancel("client-plan-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("deve aceitar cancelar no último dia do período", async () => {
      prismaMock.clientPlan.findFirst.mockResolvedValue({
        ...active,
        endDate: new Date("2026-10-09"),
      });

      await expect(
        clientPlanService.cancel("client-plan-1", COMPANY_ID),
      ).resolves.toBeDefined();
    });

    it("deve lançar NotFoundException para contratação de outra empresa", async () => {
      prismaMock.clientPlan.findFirst.mockResolvedValueOnce(null);

      await expect(
        clientPlanService.cancel("client-plan-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("consultas", () => {
    it("deve filtrar por empresa, cliente e plano", async () => {
      prismaMock.clientPlan.findMany.mockResolvedValue([]);
      prismaMock.clientPlan.count.mockResolvedValue(0);

      await clientPlanService.findAll(
        { page: 1, limit: 10, clientId: "client-1", planId: "plan-1" },
        COMPANY_ID,
      );

      expect(prismaMock.clientPlan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId: COMPANY_ID,
            clientId: "client-1",
            planId: "plan-1",
          },
        }),
      );
    });

    it("deve lançar NotFoundException para contratação de outra empresa", async () => {
      prismaMock.clientPlan.findFirst.mockResolvedValueOnce(null);

      await expect(
        clientPlanService.findOne("client-plan-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
