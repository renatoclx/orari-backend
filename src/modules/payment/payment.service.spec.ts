import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_ID } from "../../../test/fixtures/authenticated-users";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AppointmentService } from "../appointment/appointment.service";
import { CompanyService } from "../company/company.service";
import { PaymentMethodService } from "../payment-method/payment-method.service";
import { ServiceService } from "../service/service.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { PaymentService } from "./payment.service";

const anyDate: unknown = expect.any(Date);

// Filtro esperado de "pagamento da empresa": a empresa fica no próprio pagamento.
const ownedByCompany = { companyId: COMPANY_ID };

describe("PaymentService", () => {
  let paymentService: PaymentService;
  const prismaMock: Record<string, unknown> & {
    payment: Record<string, ReturnType<typeof vi.fn>>;
    people: Record<string, ReturnType<typeof vi.fn>>;
  } = {
    // Aceita a forma em lote (array) e a interativa (função, que recebe o próprio mock).
    $transaction: vi.fn(
      (operations: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
        typeof operations === "function"
          ? operations(prismaMock)
          : Promise.all(operations),
    ),
    people: { findMany: vi.fn(), count: vi.fn() },
    payment: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
      aggregate: vi.fn(),
    },
  };
  const appointmentServiceMock = { findDetail: vi.fn() };
  const paymentMethodServiceMock = { findOne: vi.fn() };
  const serviceServiceMock = { findOne: vi.fn() };
  // "Hoje" do atraso: os testes usam UTC e um relógio fixo.
  const companyServiceMock = { getTimeZone: vi.fn() };

  const dto: CreatePaymentDto = {
    appointmentId: "appointment-1",
    amount: 120.5,
    paymentMethodId: "method-1",
  };
  const payment = {
    id: "payment-1",
    ...dto,
    status: "PENDING",
    paidAt: null,
    deletedAt: null,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-10-10T12:00:00.000Z"));
    companyServiceMock.getTimeZone.mockResolvedValue("UTC");
    // A edição devolve o pagamento gravado, usado para calcular o isOverdue.
    prismaMock.payment.update.mockResolvedValue(payment);
    appointmentServiceMock.findDetail.mockResolvedValue({
      id: "appointment-1",
      serviceId: "service-1",
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AppointmentService, useValue: appointmentServiceMock },
        { provide: PaymentMethodService, useValue: paymentMethodServiceMock },
        { provide: ServiceService, useValue: serviceServiceMock },
        { provide: CompanyService, useValue: companyServiceMock },
      ],
    }).compile();

    paymentService = module.get<PaymentService>(PaymentService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("create", () => {
    it("deve validar agendamento e método e criar como PENDING", async () => {
      prismaMock.payment.create.mockResolvedValue(payment);

      await paymentService.create(dto, COMPANY_ID);

      expect(appointmentServiceMock.findDetail).toHaveBeenCalledWith(
        "appointment-1",
        COMPANY_ID,
      );
      expect(paymentMethodServiceMock.findOne).toHaveBeenCalledWith(
        "method-1",
        COMPANY_ID,
      );
      expect(prismaMock.payment.create).toHaveBeenCalledWith({
        data: { ...dto, status: "PENDING", companyId: COMPANY_ID },
      });
    });

    it("deve assumir o preço do serviço quando o valor não é informado", async () => {
      serviceServiceMock.findOne.mockResolvedValue({ price: 80 });
      prismaMock.payment.create.mockResolvedValue(payment);
      const semValor = { ...dto, amount: undefined };

      await paymentService.create(semValor, COMPANY_ID);

      expect(serviceServiceMock.findOne).toHaveBeenCalledWith(
        "service-1",
        COMPANY_ID,
      );
      expect(prismaMock.payment.create).toHaveBeenCalledWith({
        data: {
          ...semValor,
          amount: 80,
          status: "PENDING",
          companyId: COMPANY_ID,
        },
      });
    });

    it("deve exigir o valor quando o serviço não tem preço", async () => {
      serviceServiceMock.findOne.mockResolvedValue({ price: null });
      const semValor = { ...dto, amount: undefined };

      await expect(
        paymentService.create(semValor, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.payment.create).not.toHaveBeenCalled();
    });

    it("não deve consultar o serviço quando o valor é informado", async () => {
      prismaMock.payment.create.mockResolvedValue(payment);

      await paymentService.create(dto, COMPANY_ID);

      expect(serviceServiceMock.findOne).not.toHaveBeenCalled();
    });

    it("deve recusar agendamento de outra empresa", async () => {
      appointmentServiceMock.findDetail.mockRejectedValueOnce(
        new NotFoundException(),
      );

      await expect(
        paymentService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.payment.create).not.toHaveBeenCalled();
    });

    it("deve recusar pagamento para agendamento cancelado, sem gravar nada", async () => {
      appointmentServiceMock.findDetail.mockResolvedValueOnce({
        id: "appointment-1",
        serviceId: "service-1",
        status: "CANCELLED",
      });

      await expect(paymentService.create(dto, COMPANY_ID)).rejects.toThrow(
        "Agendamento cancelado não pode receber pagamento",
      );
      expect(paymentMethodServiceMock.findOne).not.toHaveBeenCalled();
      expect(prismaMock.payment.create).not.toHaveBeenCalled();
    });

    it("deve recusar pagamento para sessão de pacote, sem gravar nada", async () => {
      appointmentServiceMock.findDetail.mockResolvedValueOnce({
        id: "appointment-1",
        serviceId: "service-1",
        status: "SCHEDULED",
        recurringAppointment: { id: "recurring-1", clientPlanId: "plan-1" },
      });

      await expect(
        paymentService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.payment.create).not.toHaveBeenCalled();
    });

    // Recorrência avulsa: se o pagamento dela foi excluído, um novo é permitido.
    it("deve aceitar pagamento para agendamento de recorrência avulsa", async () => {
      appointmentServiceMock.findDetail.mockResolvedValueOnce({
        id: "appointment-1",
        serviceId: "service-1",
        status: "SCHEDULED",
        recurringAppointment: { id: "recurring-1", clientPlanId: null },
      });
      prismaMock.payment.create.mockResolvedValue(payment);

      await expect(
        paymentService.create(dto, COMPANY_ID),
      ).resolves.toBeDefined();
    });

    it.each(["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "NO_SHOW"])(
      "deve aceitar pagamento para agendamento %s",
      async (status) => {
        appointmentServiceMock.findDetail.mockResolvedValueOnce({
          id: "appointment-1",
          serviceId: "service-1",
          status,
        });
        prismaMock.payment.create.mockResolvedValue(payment);

        await expect(
          paymentService.create(dto, COMPANY_ID),
        ).resolves.toBeDefined();
      },
    );

    it("deve exigir paidAt quando o status é PAID", async () => {
      await expect(
        paymentService.create({ ...dto, status: "PAID" }, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("deve recusar paidAt quando o status não é PAID", async () => {
      await expect(
        paymentService.create({ ...dto, paidAt: new Date() }, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("deve aceitar PAID com paidAt", async () => {
      prismaMock.payment.create.mockResolvedValue(payment);

      await expect(
        paymentService.create(
          { ...dto, status: "PAID", paidAt: new Date("2026-10-01") },
          COMPANY_ID,
        ),
      ).resolves.toBeDefined();
    });

    it("deve aceitar PENDING sem método de pagamento", async () => {
      prismaMock.payment.create.mockResolvedValue(payment);
      const semMetodo = { ...dto, paymentMethodId: undefined };

      await paymentService.create(semMetodo, COMPANY_ID);

      expect(paymentMethodServiceMock.findOne).not.toHaveBeenCalled();
      expect(prismaMock.payment.create).toHaveBeenCalled();
    });

    it("deve exigir método de pagamento quando o status é PAID", async () => {
      await expect(
        paymentService.create(
          {
            ...dto,
            paymentMethodId: undefined,
            status: "PAID",
            paidAt: new Date("2026-10-01"),
          },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.payment.create).not.toHaveBeenCalled();
    });

    it("deve lançar ConflictException quando o agendamento já tem pagamento", async () => {
      prismaMock.payment.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(
        paymentService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("findAll", () => {
    const today = new Date("2026-10-10");
    const whereOf = () =>
      (
        prismaMock.payment.findMany.mock.calls[0][0] as {
          where: Record<string, unknown>;
        }
      ).where;

    beforeEach(() => {
      prismaMock.payment.findMany.mockResolvedValue([payment]);
      prismaMock.payment.count.mockResolvedValue(1);
    });

    it("deve restringir à empresa do pagamento e aplicar os filtros", async () => {
      await paymentService.findAll(
        {
          page: 1,
          limit: 10,
          status: "PENDING",
          appointmentId: "appointment-1",
          paymentMethodId: "method-1",
        },
        COMPANY_ID,
      );

      expect(prismaMock.payment.count).toHaveBeenCalledWith({
        where: {
          ...ownedByCompany,
          deletedAt: null,
          status: "PENDING",
          appointmentId: "appointment-1",
          paymentMethodId: "method-1",
          AND: [],
        },
      });
    });

    it("deve trazer a origem do pagamento (atendimento ou plano)", async () => {
      await paymentService.findAll({ page: 1, limit: 10 }, COMPANY_ID);

      const [{ include }] = prismaMock.payment.findMany.mock.calls[0] as [
        { include: Record<string, unknown> },
      ];
      expect(Object.keys(include)).toEqual([
        "paymentMethod",
        "appointment",
        "clientPlan",
      ]);
    });

    it("deve levar o cliente do atendimento ou da contratação para o pagamento", async () => {
      prismaMock.payment.findMany.mockResolvedValue([
        {
          ...payment,
          id: "p-appointment",
          paymentMethod: { id: "method-1", name: "Pix" },
          appointment: {
            id: "a1",
            startAt: new Date("2026-10-10T13:00:00.000Z"),
            recurringAppointmentId: null,
            service: { id: "s1", name: "Corte" },
            client: { id: "c1", name: "Ana" },
          },
          clientPlan: null,
        },
        {
          ...payment,
          id: "p-plan",
          paymentMethod: null,
          appointment: null,
          clientPlan: {
            id: "cp1",
            billingType: "MONTHLY",
            plan: { id: "pl1", name: "Pacote" },
            client: { id: "c2", name: "Bia" },
          },
        },
      ]);

      const { items } = await paymentService.findAll(
        { page: 1, limit: 10 },
        COMPANY_ID,
      );

      expect(items[0].client).toEqual({ id: "c1", name: "Ana" });
      expect(items[0].paymentMethod).toEqual({ id: "method-1", name: "Pix" });
      expect(items[0].appointment).toEqual({
        id: "a1",
        startAt: new Date("2026-10-10T13:00:00.000Z"),
        recurringAppointmentId: null,
        service: { id: "s1", name: "Corte" },
      });
      expect(items[0].clientPlan).toBeNull();
      expect(items[1].client).toEqual({ id: "c2", name: "Bia" });
      expect(items[1].paymentMethod).toBeNull();
      expect(items[1].appointment).toBeNull();
      expect(items[1].clientPlan).toEqual({
        id: "cp1",
        billingType: "MONTHLY",
        plan: { id: "pl1", name: "Pacote" },
      });
    });

    it("deve combinar os filtros de status e atraso", async () => {
      await paymentService.findAll(
        { page: 1, limit: 10, status: "PENDING", overdue: true },
        COMPANY_ID,
      );

      expect(whereOf()).toEqual({
        ...ownedByCompany,
        deletedAt: null,
        status: "PENDING",
        AND: [{ status: "PENDING", dueDate: { lt: today } }],
      });
    });

    it("deve ordenar por vencimento, com os sem vencimento no fim", async () => {
      await paymentService.findAll({ page: 1, limit: 10 }, COMPANY_ID);

      expect(prismaMock.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { dueDate: { sort: "asc", nulls: "last" } },
            { createdAt: "desc" },
          ],
        }),
      );
    });

    it("deve filtrar por cliente vindo do agendamento ou da contratação", async () => {
      await paymentService.findAll(
        { page: 1, limit: 10, clientId: "client-1" },
        COMPANY_ID,
      );

      expect(whereOf().AND).toEqual([
        {
          OR: [
            { appointment: { clientId: "client-1" } },
            { clientPlan: { clientId: "client-1" } },
          ],
        },
      ]);
    });

    it("deve filtrar pela recorrência do agendamento", async () => {
      await paymentService.findAll(
        { page: 1, limit: 10, recurringAppointmentId: "recurring-1" },
        COMPANY_ID,
      );

      expect(whereOf().AND).toEqual([
        { appointment: { recurringAppointmentId: "recurring-1" } },
      ]);
    });

    it("deve filtrar os atrasados pelo dia de hoje no fuso da empresa", async () => {
      // 01:00 UTC de 11/10 ainda é 10/10 em São Paulo.
      vi.setSystemTime(new Date("2026-10-11T01:00:00.000Z"));
      companyServiceMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");

      await paymentService.findAll(
        { page: 1, limit: 10, overdue: true },
        COMPANY_ID,
      );

      expect(whereOf().AND).toEqual([
        { status: "PENDING", dueDate: { lt: today } },
      ]);
    });

    it("deve filtrar os não atrasados sem descartar os sem vencimento", async () => {
      await paymentService.findAll(
        { page: 1, limit: 10, overdue: false },
        COMPANY_ID,
      );

      expect(whereOf().AND).toEqual([
        {
          OR: [
            { status: { not: "PENDING" } },
            { dueDate: null },
            { dueDate: { gte: today } },
          ],
        },
      ]);
    });

    it("deve filtrar pelo período de vencimento", async () => {
      const dueFrom = new Date("2026-10-01");
      const dueTo = new Date("2026-10-31");

      await paymentService.findAll(
        { page: 1, limit: 10, dueFrom, dueTo },
        COMPANY_ID,
      );

      expect(whereOf().AND).toEqual([
        { dueDate: { gte: dueFrom, lte: dueTo } },
      ]);
    });

    it("deve marcar isOverdue em cada pagamento", async () => {
      prismaMock.payment.findMany.mockResolvedValue([
        { ...payment, status: "PENDING", dueDate: new Date("2026-10-09") },
        { ...payment, status: "PENDING", dueDate: new Date("2026-10-10") },
        { ...payment, status: "PENDING", dueDate: null },
        { ...payment, status: "PAID", dueDate: new Date("2026-10-01") },
      ]);

      const result = await paymentService.findAll(
        { page: 1, limit: 10 },
        COMPANY_ID,
      );

      // Vence hoje não é atraso; sem vencimento e pago também não.
      expect(result.items.map((item) => item.isOverdue)).toEqual([
        true,
        false,
        false,
        false,
      ]);
    });
  });

  describe("findOne", () => {
    it("deve buscar apenas pagamentos da empresa", async () => {
      prismaMock.payment.findFirst.mockResolvedValue(null);

      await expect(
        paymentService.findOne("payment-1", COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.payment.findFirst).toHaveBeenCalledWith({
        where: { id: "payment-1", deletedAt: null, ...ownedByCompany },
      });
    });
  });

  describe("update", () => {
    it("deve registrar o pagamento ao mudar para PAID com a data", async () => {
      prismaMock.payment.findFirst.mockResolvedValue(payment);
      const paidAt = new Date("2026-10-02T10:00:00.000Z");

      await paymentService.update(
        "payment-1",
        { status: "PAID", paidAt },
        COMPANY_ID,
      );

      expect(prismaMock.payment.update).toHaveBeenCalledWith({
        where: { id: "payment-1" },
        data: { status: "PAID", paidAt, updatedAt: anyDate },
      });
    });

    it("deve limpar paidAt ao sair de PAID, sem exigir a data no PATCH", async () => {
      prismaMock.payment.findFirst.mockResolvedValue({
        ...payment,
        status: "PAID",
        paidAt: new Date("2026-10-02"),
      });

      await paymentService.update(
        "payment-1",
        { status: "CANCELLED" },
        COMPANY_ID,
      );

      expect(prismaMock.payment.update).toHaveBeenCalledWith({
        where: { id: "payment-1" },
        data: { status: "CANCELLED", paidAt: null, updatedAt: anyDate },
      });
    });

    it("deve recusar paidAt informado junto com um status diferente de PAID", async () => {
      prismaMock.payment.findFirst.mockResolvedValue({
        ...payment,
        status: "PAID",
        paidAt: new Date("2026-10-02"),
      });

      await expect(
        paymentService.update(
          "payment-1",
          { status: "CANCELLED", paidAt: new Date("2026-10-03") },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.payment.update).not.toHaveBeenCalled();
    });

    it("deve manter a data ao editar outros campos de um pagamento PAID", async () => {
      const paidAt = new Date("2026-10-02");
      prismaMock.payment.findFirst.mockResolvedValue({
        ...payment,
        status: "PAID",
        paidAt,
      });

      await paymentService.update("payment-1", { amount: 99.9 }, COMPANY_ID);

      expect(prismaMock.payment.update).toHaveBeenCalledWith({
        where: { id: "payment-1" },
        data: { amount: 99.9, paidAt, updatedAt: anyDate },
      });
    });

    it("deve recusar baixa para PAID quando o pagamento não tem método", async () => {
      prismaMock.payment.findFirst.mockResolvedValue({
        ...payment,
        paymentMethodId: null,
      });

      await expect(
        paymentService.update(
          "payment-1",
          { status: "PAID", paidAt: new Date("2026-10-02") },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.payment.update).not.toHaveBeenCalled();
    });

    it("deve aceitar baixa para PAID informando o método no PATCH", async () => {
      prismaMock.payment.findFirst.mockResolvedValue({
        ...payment,
        paymentMethodId: null,
      });
      const paidAt = new Date("2026-10-02");

      await paymentService.update(
        "payment-1",
        { status: "PAID", paidAt, paymentMethodId: "method-1" },
        COMPANY_ID,
      );

      expect(paymentMethodServiceMock.findOne).toHaveBeenCalledWith(
        "method-1",
        COMPANY_ID,
      );
      expect(prismaMock.payment.update).toHaveBeenCalled();
    });

    it.each(["PENDING", "PAID"])(
      "não deve reabrir um pagamento cancelado (CANCELLED → %s)",
      async (status) => {
        prismaMock.payment.findFirst.mockResolvedValue({
          ...payment,
          status: "CANCELLED",
        });

        await expect(
          paymentService.update(
            "payment-1",
            {
              status,
              paidAt: new Date("2026-10-02"),
              paymentMethodId: "m",
            } as never,
            COMPANY_ID,
          ),
        ).rejects.toThrow("Pagamento cancelado não pode mudar de status");
        expect(prismaMock.payment.update).not.toHaveBeenCalled();
      },
    );

    it("deve aceitar repetir CANCELLED num pagamento cancelado, sem efeito", async () => {
      prismaMock.payment.findFirst.mockResolvedValue({
        ...payment,
        status: "CANCELLED",
      });

      await expect(
        paymentService.update("payment-1", { status: "CANCELLED" }, COMPANY_ID),
      ).resolves.toBeDefined();
    });

    it("deve continuar permitindo editar outros campos de um pagamento cancelado", async () => {
      prismaMock.payment.findFirst.mockResolvedValue({
        ...payment,
        status: "CANCELLED",
      });

      await expect(
        paymentService.update("payment-1", { amount: 99.9 }, COMPANY_ID),
      ).resolves.toBeDefined();
    });

    it("deve recusar mudança para PAID sem data", async () => {
      prismaMock.payment.findFirst.mockResolvedValue(payment);

      await expect(
        paymentService.update("payment-1", { status: "PAID" }, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.payment.update).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("deve excluir logicamente o pagamento", async () => {
      prismaMock.payment.findFirst.mockResolvedValue(payment);

      await paymentService.remove("payment-1", COMPANY_ID);

      expect(prismaMock.payment.update).toHaveBeenCalledWith({
        where: { id: "payment-1" },
        data: { deletedAt: anyDate, updatedAt: anyDate },
      });
    });
  });

  describe("cobrança dos avulsos concluídos", () => {
    const completed = (overrides: object = {}) => ({
      id: "appointment-1",
      companyId: "company-1",
      // 01:00 UTC de 10/10 ainda é 09/10 às 22h em São Paulo.
      startAt: new Date("2026-10-10T01:00:00.000Z"),
      service: { price: 120 },
      company: { timezone: "America/Sao_Paulo" },
      ...overrides,
    });

    it("deve gerar PENDING sem método, com o preço do serviço e vencimento no dia local", async () => {
      prismaMock.payment.createMany.mockResolvedValue({ count: 1 });

      const created = await paymentService.createForCompletedAppointments([
        completed(),
      ] as never);

      expect(created).toBe(1);
      expect(prismaMock.payment.createMany).toHaveBeenCalledWith({
        data: [
          {
            companyId: "company-1",
            appointmentId: "appointment-1",
            amount: 120,
            dueDate: new Date("2026-10-09"),
          },
        ],
        skipDuplicates: true,
      });
    });

    it("deve usar a empresa e o fuso de cada agendamento", async () => {
      prismaMock.payment.createMany.mockResolvedValue({ count: 2 });

      await paymentService.createForCompletedAppointments([
        completed(),
        completed({
          id: "appointment-2",
          companyId: "company-2",
          company: { timezone: "UTC" },
        }),
      ] as never);

      expect(prismaMock.payment.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              companyId: "company-1",
              dueDate: new Date("2026-10-09"),
            }),
            expect.objectContaining({
              companyId: "company-2",
              dueDate: new Date("2026-10-10"),
            }),
          ],
        }),
      );
    });

    it("não deve cobrar serviço sem preço", async () => {
      prismaMock.payment.createMany.mockResolvedValue({ count: 0 });

      await paymentService.createForCompletedAppointments([
        completed({ service: { price: null } }),
      ] as never);

      expect(prismaMock.payment.createMany).toHaveBeenCalledWith({
        data: [],
        skipDuplicates: true,
      });
    });
  });

  describe("pagamentos de recorrência", () => {
    it("deve gerar PENDING sem método, com vencimento no dia local do agendamento", async () => {
      prismaMock.payment.createMany.mockResolvedValue({ count: 2 });

      const created = await paymentService.createPendingForAppointments(
        prismaMock as never,
        COMPANY_ID,
        [
          // 01:00 UTC de 07/10 ainda é 06/10 às 22h em São Paulo.
          {
            id: "appointment-1",
            startAt: new Date("2026-10-07T01:00:00.000Z"),
          },
          {
            id: "appointment-2",
            startAt: new Date("2026-10-13T17:00:00.000Z"),
          },
        ],
        100,
        "America/Sao_Paulo",
      );

      expect(created).toBe(2);
      expect(prismaMock.payment.createMany).toHaveBeenCalledWith({
        data: [
          {
            companyId: COMPANY_ID,
            appointmentId: "appointment-1",
            amount: 100,
            dueDate: new Date("2026-10-06"),
          },
          {
            companyId: COMPANY_ID,
            appointmentId: "appointment-2",
            amount: 100,
            dueDate: new Date("2026-10-13"),
          },
        ],
      });
    });

    it("deve gerar os pagamentos da contratação sem agendamento e sem método", async () => {
      prismaMock.payment.createMany.mockResolvedValue({ count: 2 });
      const amount = 380 as never;

      await paymentService.createForClientPlan(
        prismaMock as never,
        COMPANY_ID,
        "client-plan-1",
        [
          { amount, dueDate: new Date("2026-10-31") },
          { amount, dueDate: null },
        ],
      );

      expect(prismaMock.payment.createMany).toHaveBeenCalledWith({
        data: [
          {
            companyId: COMPANY_ID,
            clientPlanId: "client-plan-1",
            amount: 380,
            dueDate: new Date("2026-10-31"),
          },
          {
            companyId: COMPANY_ID,
            clientPlanId: "client-plan-1",
            amount: 380,
            dueDate: null,
          },
        ],
      });
    });

    it("deve cancelar só as parcelas PENDING que vencem a partir da data", async () => {
      prismaMock.payment.updateMany.mockResolvedValue({ count: 2 });
      const today = new Date("2026-10-10");

      await paymentService.cancelUpcomingForClientPlan(
        prismaMock as never,
        "client-plan-1",
        today,
      );

      expect(prismaMock.payment.updateMany).toHaveBeenCalledWith({
        where: {
          clientPlanId: "client-plan-1",
          status: "PENDING",
          deletedAt: null,
          dueDate: { gte: today },
        },
        data: { status: "CANCELLED", updatedAt: anyDate },
      });
    });

    it("deve cancelar só os PENDING dos agendamentos futuros cancelados", async () => {
      prismaMock.payment.updateMany.mockResolvedValue({ count: 3 });
      const from = new Date("2026-10-06T12:00:00.000Z");

      await paymentService.cancelPendingForRecurrence(
        prismaMock as never,
        "recurring-1",
        from,
      );

      expect(prismaMock.payment.updateMany).toHaveBeenCalledWith({
        where: {
          status: "PENDING",
          deletedAt: null,
          appointment: {
            recurringAppointmentId: "recurring-1",
            status: "CANCELLED",
            startAt: { gte: from },
          },
        },
        data: { status: "CANCELLED", updatedAt: anyDate },
      });
    });

    it("deve cancelar só o pagamento PENDING de um agendamento", async () => {
      prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });

      await paymentService.cancelPendingForAppointment(
        prismaMock as never,
        "appointment-1",
      );

      expect(prismaMock.payment.updateMany).toHaveBeenCalledWith({
        where: {
          appointmentId: "appointment-1",
          status: "PENDING",
          deletedAt: null,
        },
        data: { status: "CANCELLED", updatedAt: anyDate },
      });
    });

    it("deve mover o vencimento só do pagamento PENDING", async () => {
      prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });

      await paymentService.moveDueDate(
        prismaMock as never,
        "appointment-1",
        // 01:00 UTC de 21/10 ainda é 20/10 em São Paulo.
        new Date("2026-10-21T01:00:00.000Z"),
        "America/Sao_Paulo",
      );

      expect(prismaMock.payment.updateMany).toHaveBeenCalledWith({
        where: {
          appointmentId: "appointment-1",
          status: "PENDING",
          deletedAt: null,
        },
        data: { dueDate: new Date("2026-10-20"), updatedAt: anyDate },
      });
    });

    it("deve dar baixa em lote nos PENDING da recorrência com o mesmo método", async () => {
      prismaMock.payment.updateMany.mockResolvedValue({ count: 8 });
      const paidAt = new Date("2026-10-06T15:00:00.000Z");

      const settled = await paymentService.settlePendingForRecurrence(
        "recurring-1",
        { paymentMethodId: "method-1", paidAt },
        COMPANY_ID,
      );

      expect(settled).toBe(8);
      expect(paymentMethodServiceMock.findOne).toHaveBeenCalledWith(
        "method-1",
        COMPANY_ID,
      );
      expect(prismaMock.payment.updateMany).toHaveBeenCalledWith({
        where: {
          status: "PENDING",
          deletedAt: null,
          companyId: COMPANY_ID,
          appointment: { recurringAppointmentId: "recurring-1" },
        },
        data: {
          status: "PAID",
          paymentMethodId: "method-1",
          paidAt,
          updatedAt: anyDate,
        },
      });
    });

    it("deve recusar baixa em lote com paidAt no futuro", async () => {
      await expect(
        paymentService.settlePendingForRecurrence(
          "recurring-1",
          {
            paymentMethodId: "method-1",
            paidAt: new Date("2026-10-11T00:00:00.000Z"),
          },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });

    it("deve recusar baixa em lote com método de outra empresa", async () => {
      paymentMethodServiceMock.findOne.mockRejectedValueOnce(
        new NotFoundException(),
      );

      await expect(
        paymentService.settlePendingForRecurrence(
          "recurring-1",
          { paymentMethodId: "method-x" },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("summary", () => {
    // Hoje: 10/10/2026 (relógio fixo do beforeEach, fuso UTC).
    const today = new Date("2026-10-10");
    const base = { ...ownedByCompany, deletedAt: null };
    const card = (amount: string | null, count: number) => ({
      _sum: { amount: amount === null ? null : new Decimal(amount) },
      _count: { _all: count },
    });
    const whereOfCard = (index: number) =>
      (
        prismaMock.payment.aggregate.mock.calls[index][0] as {
          where: { AND: unknown[] };
        }
      ).where;

    beforeEach(() => {
      prismaMock.payment.aggregate
        .mockResolvedValueOnce(card("150.5", 2))
        .mockResolvedValueOnce(card("300", 3))
        .mockResolvedValueOnce(card("99.9", 1));
    });

    it("deve somar em Decimal e devolver o total com duas casas", async () => {
      await expect(paymentService.summary({}, COMPANY_ID)).resolves.toEqual({
        overdue: { total: "150.50", count: 2 },
        upcoming: { total: "300.00", count: 3 },
        paid: { total: "99.90", count: 1 },
      });
    });

    it("deve devolver zeros quando não há pagamentos", async () => {
      prismaMock.payment.aggregate.mockReset();
      prismaMock.payment.aggregate.mockResolvedValue(card(null, 0));

      await expect(paymentService.summary({}, COMPANY_ID)).resolves.toEqual({
        overdue: { total: "0.00", count: 0 },
        upcoming: { total: "0.00", count: 0 },
        paid: { total: "0.00", count: 0 },
      });
    });

    it("deve definir cada cartão e ignorar cancelados e excluídos", async () => {
      await paymentService.summary({}, COMPANY_ID);

      // Atrasado: PENDING com vencimento antes de hoje.
      expect(whereOfCard(0).AND).toEqual([
        base,
        { status: "PENDING", dueDate: { lt: today } },
      ]);
      // A vencer: PENDING de hoje em diante ou sem vencimento.
      expect(whereOfCard(1).AND).toEqual([
        base,
        {
          status: "PENDING",
          OR: [{ dueDate: { gte: today } }, { dueDate: null }],
        },
      ]);
      // Pago: só PAID. CANCELLED não tem cartão e excluídos saem na base.
      expect(whereOfCard(2).AND).toEqual([base, { status: "PAID" }]);
    });

    it("deve usar o vencimento no período nos três e tirar os sem vencimento", async () => {
      const dueFrom = new Date("2026-10-01");
      const dueTo = new Date("2026-10-31");

      await paymentService.summary({ dueFrom, dueTo }, COMPANY_ID);

      const period = { dueDate: { gte: dueFrom, lte: dueTo } };
      expect(whereOfCard(0).AND).toContainEqual(period);
      expect(whereOfCard(1).AND).toContainEqual(period);
      expect(whereOfCard(2).AND).toContainEqual(period);
      // Com período, o "a vencer" não inclui o sem vencimento.
      expect(whereOfCard(1).AND).toContainEqual({
        status: "PENDING",
        OR: [{ dueDate: { gte: today } }],
      });
    });

    it("deve filtrar pelo cliente do atendimento ou da contratação", async () => {
      await paymentService.summary({ clientId: "client-1" }, COMPANY_ID);

      for (const index of [0, 1, 2]) {
        expect(whereOfCard(index).AND).toContainEqual({
          OR: [
            { appointment: { clientId: "client-1" } },
            { clientPlan: { clientId: "client-1" } },
          ],
        });
      }
    });

    it("deve usar o dia no fuso da empresa", async () => {
      // 01:00 UTC de 11/10 ainda é 10/10 em São Paulo.
      vi.setSystemTime(new Date("2026-10-11T01:00:00.000Z"));
      companyServiceMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");

      await paymentService.summary({}, COMPANY_ID);

      expect(whereOfCard(0).AND).toContainEqual({
        status: "PENDING",
        dueDate: { lt: today },
      });
    });

    it("não deve carregar os pagamentos, só agregar", async () => {
      await paymentService.summary({}, COMPANY_ID);

      expect(prismaMock.payment.findMany).not.toHaveBeenCalled();
      expect(prismaMock.payment.aggregate).toHaveBeenCalledTimes(3);
    });
  });

  describe("findCheckouts", () => {
    // Hoje: 10/10/2026 em UTC (relógio fixo do beforeEach).
    const today = new Date("2026-10-10");
    const fromAppointment = (
      id: string,
      clientId: string,
      amount: string,
      status = "PENDING",
    ) => ({
      id,
      status,
      amount: new Decimal(amount),
      appointment: { id: `a-${id}`, clientId },
      clientPlan: null,
    });
    const fromPlan = (id: string, clientId: string, amount: string) => ({
      id,
      status: "PENDING",
      amount: new Decimal(amount),
      appointment: null,
      clientPlan: { id: `cp-${id}`, clientId, billingType: "INTEGRAL" },
    });

    it("deve filtrar o dia: vencem hoje, integral sem vencimento e pagos hoje", async () => {
      prismaMock.payment.findMany.mockResolvedValue([]);
      prismaMock.people.findMany.mockResolvedValue([]);
      prismaMock.people.count.mockResolvedValue(0);

      await paymentService.findCheckouts({ page: 1, limit: 10 }, COMPANY_ID);

      // Atrasado (dueDate < hoje), futuro, CANCELLED, excluído e pago ontem
      // ficam de fora porque nenhuma das três regras os alcança.
      expect(prismaMock.payment.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: {
            companyId: COMPANY_ID,
            deletedAt: null,
            OR: [
              { status: "PENDING", dueDate: today },
              {
                status: "PENDING",
                dueDate: null,
                clientPlan: { billingType: "INTEGRAL" },
              },
              {
                status: "PAID",
                paidAt: {
                  gte: new Date("2026-10-10T00:00:00.000Z"),
                  lt: new Date("2026-10-11T00:00:00.000Z"),
                },
              },
            ],
          },
        }),
      );
    });

    it("deve usar o dia no fuso da empresa", async () => {
      // 01:00 UTC de 11/10 ainda é 10/10 em São Paulo (UTC-3).
      vi.setSystemTime(new Date("2026-10-11T01:00:00.000Z"));
      companyServiceMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");
      prismaMock.payment.findMany.mockResolvedValue([]);
      prismaMock.people.findMany.mockResolvedValue([]);
      prismaMock.people.count.mockResolvedValue(0);

      await paymentService.findCheckouts({ page: 1, limit: 10 }, COMPANY_ID);

      const [{ where }] = prismaMock.payment.findMany.mock.calls[0] as [
        { where: { OR: Record<string, unknown>[] } },
      ];
      expect(where.OR[0].dueDate).toEqual(today);
      expect(where.OR[2].paidAt).toEqual({
        gte: new Date("2026-10-10T03:00:00.000Z"),
        lt: new Date("2026-10-11T03:00:00.000Z"),
      });
    });

    it("deve agrupar por cliente, somar os totais e paginar por cliente", async () => {
      prismaMock.payment.findMany
        .mockResolvedValueOnce([
          fromAppointment("p1", "c1", "100"),
          fromPlan("p2", "c1", "50.5"),
          fromAppointment("p3", "c2", "30"),
        ])
        .mockResolvedValueOnce([
          fromAppointment("p1", "c1", "100"),
          fromPlan("p2", "c1", "50.5"),
          fromAppointment("p4", "c1", "20", "PAID"),
        ]);
      prismaMock.people.findMany.mockResolvedValue([{ id: "c1", name: "Ana" }]);
      prismaMock.people.count.mockResolvedValue(2);

      const result = await paymentService.findCheckouts(
        { page: 1, limit: 1 },
        COMPANY_ID,
      );

      expect(prismaMock.people.findMany).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY_ID,
          id: { in: ["c1", "c2"] },
          normalizedName: undefined,
        },
        select: { id: true, name: true },
        orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
        skip: 0,
        take: 1,
      });
      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].client).toEqual({ id: "c1", name: "Ana" });
      expect(result.items[0].total.toString()).toBe("170.5");
      expect(result.items[0].pendingTotal.toString()).toBe("150.5");
      expect(result.items[0].payments).toHaveLength(3);
    });

    it("deve buscar o nome sem acento nem maiúsculas", async () => {
      prismaMock.payment.findMany.mockResolvedValue([]);
      prismaMock.people.findMany.mockResolvedValue([]);
      prismaMock.people.count.mockResolvedValue(0);

      await paymentService.findCheckouts(
        { page: 2, limit: 5, search: "JOSÉ" },
        COMPANY_ID,
      );

      expect(prismaMock.people.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            normalizedName: { contains: "jose" },
          }) as unknown,
          skip: 5,
          take: 5,
        }),
      );
    });

    it("não deve buscar pagamentos quando a página não tem clientes", async () => {
      prismaMock.payment.findMany.mockResolvedValue([]);
      prismaMock.people.findMany.mockResolvedValue([]);
      prismaMock.people.count.mockResolvedValue(0);

      const result = await paymentService.findCheckouts(
        { page: 1, limit: 10 },
        COMPANY_ID,
      );

      expect(result.items).toEqual([]);
      expect(prismaMock.payment.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("settle", () => {
    const ids = ["p1", "p2"];
    const body = { paymentIds: ids, paymentMethodId: "method-1" };
    const pending = (clientId: string, status = "PENDING") => ({
      status,
      appointment: { clientId },
      clientPlan: null,
    });

    beforeEach(() => {
      prismaMock.payment.findMany.mockResolvedValue([
        pending("c1"),
        pending("c1"),
      ]);
      prismaMock.payment.updateMany.mockResolvedValue({ count: 2 });
    });

    it("deve dar baixa numa transação, com método e o momento da requisição", async () => {
      const result = await paymentService.settle(body, COMPANY_ID);

      expect(result).toEqual({ settled: 2 });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.payment.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ids },
          status: "PENDING",
          deletedAt: null,
          companyId: COMPANY_ID,
        },
        data: {
          status: "PAID",
          paymentMethodId: "method-1",
          paidAt: new Date("2026-10-10T12:00:00.000Z"),
          updatedAt: anyDate,
        },
      });
    });

    it("deve recusar paidAt no futuro sem gravar nada", async () => {
      const paidAt = new Date("2026-10-10T12:00:01.000Z");

      await expect(
        paymentService.settle({ ...body, paidAt }, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });

    it("deve aceitar paidAt passado (baixa esquecida) e o instante atual", async () => {
      await expect(
        paymentService.settle(
          { ...body, paidAt: new Date("2026-09-01T10:00:00.000Z") },
          COMPANY_ID,
        ),
      ).resolves.toEqual({ settled: 2 });
      await expect(
        paymentService.settle(
          { ...body, paidAt: new Date("2026-10-10T12:00:00.000Z") },
          COMPANY_ID,
        ),
      ).resolves.toEqual({ settled: 2 });
    });

    it("deve usar o paidAt informado", async () => {
      const paidAt = new Date("2026-10-09T15:00:00.000Z");

      await paymentService.settle({ ...body, paidAt }, COMPANY_ID);

      expect(prismaMock.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paidAt }) as unknown,
        }),
      );
    });

    it("deve lançar NotFoundException quando algum pagamento não é da empresa", async () => {
      prismaMock.payment.findMany.mockResolvedValue([pending("c1")]);

      await expect(
        paymentService.settle(body, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });

    it("deve lançar NotFoundException para método inexistente na empresa", async () => {
      paymentMethodServiceMock.findOne.mockRejectedValueOnce(
        new NotFoundException(),
      );

      await expect(
        paymentService.settle(body, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });

    it("deve lançar ConflictException quando algum não está PENDING", async () => {
      prismaMock.payment.findMany.mockResolvedValue([
        pending("c1"),
        pending("c1", "PAID"),
      ]);

      await expect(
        paymentService.settle(body, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });

    it("deve lançar BadRequestException para clientes diferentes", async () => {
      prismaMock.payment.findMany.mockResolvedValue([
        pending("c1"),
        pending("c2"),
      ]);

      await expect(
        paymentService.settle(body, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });

    it("deve lançar ConflictException se uma baixa concorrente tirou algum do PENDING", async () => {
      prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        paymentService.settle(body, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
