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
    appointment: Record<string, ReturnType<typeof vi.fn>>;
  } = {
    // Aceita a forma em lote (array) e a interativa (função, que recebe o próprio mock).
    $transaction: vi.fn(
      (operations: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
        typeof operations === "function"
          ? operations(prismaMock)
          : Promise.all(operations),
    ),
    people: { findMany: vi.fn(), count: vi.fn() },
    appointment: { findMany: vi.fn() },
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

    it("deve recusar paidAt no futuro na criação, sem gravar nada", async () => {
      await expect(
        paymentService.create(
          {
            ...dto,
            status: "PAID",
            paidAt: new Date("2026-10-11T00:00:00.000Z"),
          },
          COMPANY_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.payment.create).not.toHaveBeenCalled();
    });

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

    it("sessão de turma cancelada: cancela os pagamentos PENDING dos agendamentos cancelados nela", async () => {
      prismaMock.payment.updateMany.mockResolvedValue({ count: 2 });

      await expect(
        paymentService.cancelPendingForClassSession(
          prismaMock as never,
          "session-1",
        ),
      ).resolves.toBe(2);
      expect(prismaMock.payment.updateMany).toHaveBeenCalledWith({
        where: {
          status: "PENDING",
          deletedAt: null,
          appointment: { classSessionId: "session-1", status: "CANCELLED" },
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
    const dayStart = new Date("2026-10-10T00:00:00.000Z");
    const dayEnd = new Date("2026-10-11T00:00:00.000Z");
    const ana = { id: "c1", name: "Ana" };

    const visit = (id: string, startAt: string, extra: object = {}) => ({
      id,
      clientId: "c1",
      startAt: new Date(startAt),
      status: "SCHEDULED",
      recurringAppointmentId: null,
      service: { id: "s1", name: "Corte" },
      professional: { id: "pr1", name: "Bia" },
      recurringAppointment: null,
      ...extra,
    });
    const charge = (id: string, extra: object = {}) => ({
      id,
      amount: new Decimal("100"),
      dueDate: today,
      status: "PENDING",
      paidAt: null,
      paymentMethod: null,
      appointmentId: null,
      appointment: null,
      clientPlan: null,
      ...extra,
    });
    // Pagamento de um atendimento do cliente c1.
    const ofVisit = (id: string, appointmentId: string, extra: object = {}) =>
      charge(id, {
        appointmentId,
        appointment: {
          id: appointmentId,
          clientId: "c1",
          startAt: new Date("2026-10-10T13:00:00.000Z"),
          recurringAppointmentId: null,
          service: { id: "s1", name: "Corte" },
        },
        ...extra,
      });
    // Pagamento de uma contratação do cliente c1.
    const ofPlan = (id: string, billingType: string, extra: object = {}) =>
      charge(id, {
        clientPlan: {
          id: "cp1",
          clientId: "c1",
          billingType,
          plan: { id: "pl1", name: "Pacote" },
        },
        ...extra,
      });

    const setup = ({
      clients = [ana] as { id: string; name: string }[],
      appointments = [] as object[],
      payments = [] as object[],
    } = {}) => {
      prismaMock.people.findMany.mockResolvedValue(clients);
      prismaMock.people.count.mockResolvedValue(clients.length);
      prismaMock.appointment.findMany.mockResolvedValue(appointments);
      prismaMock.payment.findMany.mockResolvedValue(payments);
    };
    const run = (query: object = {}) =>
      paymentService.findCheckouts(
        { page: 1, limit: 10, ...query },
        COMPANY_ID,
      );
    const clientsWhere = () =>
      (
        prismaMock.people.findMany.mock.calls[0][0] as {
          where: Record<string, unknown>;
        }
      ).where;

    describe("quem tem comanda", () => {
      it("deve incluir quem tem atendimento hoje (ativo) ou pagamento pago hoje", async () => {
        setup();

        await run();

        const paidToday = {
          deletedAt: null,
          status: "PAID",
          paidAt: { gte: dayStart, lt: dayEnd },
        };
        expect(clientsWhere()).toEqual({
          companyId: COMPANY_ID,
          normalizedName: undefined,
          OR: [
            {
              appointmentsAsClient: {
                some: {
                  startAt: { gte: dayStart, lt: dayEnd },
                  // Cancelado e não compareceu ficam de fora.
                  status: {
                    in: ["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "COMPLETED"],
                  },
                },
              },
            },
            { appointmentsAsClient: { some: { payment: { is: paidToday } } } },
            { clientPlans: { some: { payments: { some: paidToday } } } },
          ],
        });
      });

      it("não deve filtrar por exclusão da pessoa nem carregar dados sem clientes", async () => {
        setup({ clients: [] });

        const result = await run();

        expect(result).toEqual({ items: [], total: 0, page: 1, limit: 10 });
        expect(clientsWhere()).not.toHaveProperty("deletedAt");
        expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
        expect(prismaMock.payment.findMany).not.toHaveBeenCalled();
      });

      it("deve buscar o nome sem acento nem maiúsculas e paginar por cliente", async () => {
        setup();

        await run({ page: 2, limit: 5, search: "JOSÉ" });

        expect(clientsWhere()).toMatchObject({
          normalizedName: { contains: "jose" },
        });
        expect(prismaMock.people.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
            skip: 5,
            take: 5,
          }),
        );
      });

      it("deve usar o dia no fuso da empresa", async () => {
        // 01:00 UTC de 11/10 ainda é 10/10 em São Paulo (UTC-3).
        vi.setSystemTime(new Date("2026-10-11T01:00:00.000Z"));
        companyServiceMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");
        setup();

        await run();

        expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              startAt: {
                gte: new Date("2026-10-10T03:00:00.000Z"),
                lt: new Date("2026-10-11T03:00:00.000Z"),
              },
            }) as unknown,
          }),
        );
      });
    });

    describe("atendimentos do dia", () => {
      it("deve listar os atendimentos do cliente em ordem de startAt, com serviço e profissional", async () => {
        setup({
          appointments: [
            visit("a1", "2026-10-10T13:00:00.000Z"),
            visit("a2", "2026-10-10T15:00:00.000Z", { status: "COMPLETED" }),
          ],
        });

        const { items } = await run();

        expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ orderBy: { startAt: "asc" } }),
        );
        expect(items[0].appointments.map((a) => a.id)).toEqual(["a1", "a2"]);
        expect(items[0].appointments[0]).toEqual({
          id: "a1",
          startAt: new Date("2026-10-10T13:00:00.000Z"),
          status: "SCHEDULED",
          service: { id: "s1", name: "Corte" },
          professional: { id: "pr1", name: "Bia" },
          recurringAppointmentId: null,
          clientPlanId: null,
          payment: null,
        });
      });

      it("deve trazer o pagamento do atendimento com o método e o atraso", async () => {
        setup({
          appointments: [visit("a1", "2026-10-10T13:00:00.000Z")],
          payments: [
            ofVisit("p1", "a1", {
              dueDate: new Date("2026-10-09"),
              paymentMethod: { id: "m1", name: "Pix" },
            }),
          ],
        });

        const { items } = await run();

        expect(items[0].appointments[0].payment).toEqual({
          id: "p1",
          amount: new Decimal("100"),
          dueDate: new Date("2026-10-09"),
          status: "PENDING",
          paidAt: null,
          paymentMethod: { id: "m1", name: "Pix" },
          isOverdue: true,
        });
      });

      it("deve deixar payment nulo no atendimento sem pagamento", async () => {
        setup({ appointments: [visit("a1", "2026-10-10T13:00:00.000Z")] });

        const { items } = await run();

        expect(items[0].appointments[0].payment).toBeNull();
      });

      it("deve marcar a sessão de pacote com o clientPlanId, sem pagamento próprio", async () => {
        setup({
          appointments: [
            visit("a1", "2026-10-10T13:00:00.000Z", {
              recurringAppointmentId: "r1",
              recurringAppointment: { clientPlanId: "cp1" },
            }),
          ],
        });

        const { items } = await run();

        expect(items[0].appointments[0]).toMatchObject({
          recurringAppointmentId: "r1",
          clientPlanId: "cp1",
          payment: null,
        });
      });

      it("deve ignorar o pagamento cancelado ou excluído na consulta", async () => {
        setup({ appointments: [visit("a1", "2026-10-10T13:00:00.000Z")] });

        await run();

        expect(prismaMock.payment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              ...ownedByCompany,
              deletedAt: null,
              status: { not: "CANCELLED" },
            }) as unknown,
          }),
        );
      });
    });

    describe("pagamentos anteriores", () => {
      it("deve consultar atrasado, vencendo hoje, integral sem vencimento e pago hoje (e deixar o futuro de fora)", async () => {
        setup({ appointments: [visit("a1", "2026-10-10T13:00:00.000Z")] });

        await run();

        const [{ where }] = prismaMock.payment.findMany.mock.calls[0] as [
          { where: { AND: [unknown, { OR: unknown[] }] } },
        ];
        expect(where.AND[1].OR).toEqual([
          { appointmentId: { in: ["a1"] } },
          // Até hoje, inclusive: cobre o atrasado e o que vence hoje; o futuro não entra.
          { status: "PENDING", dueDate: { lte: today } },
          {
            status: "PENDING",
            dueDate: null,
            clientPlan: { billingType: "INTEGRAL" },
          },
          { status: "PAID", paidAt: { gte: dayStart, lt: dayEnd } },
        ]);
      });

      it("deve listar os que não são dos atendimentos de hoje, com a origem", async () => {
        setup({
          appointments: [visit("a1", "2026-10-10T13:00:00.000Z")],
          payments: [
            ofVisit("p1", "a1"),
            ofVisit("p2", "a0", { dueDate: new Date("2026-10-05") }),
            ofPlan("p3", "INTEGRAL", { dueDate: null }),
          ],
        });

        const { items } = await run();

        expect(items[0].appointments[0].payment?.id).toBe("p1");
        expect(items[0].previousPayments.map((p) => p.id)).toEqual([
          "p2",
          "p3",
        ]);
        expect(items[0].previousPayments[0]).toMatchObject({
          isOverdue: true,
          appointment: {
            id: "a0",
            startAt: new Date("2026-10-10T13:00:00.000Z"),
            recurringAppointmentId: null,
            service: { id: "s1", name: "Corte" },
          },
          clientPlan: null,
        });
        expect(items[0].previousPayments[0].appointment).not.toHaveProperty(
          "clientId",
        );
        expect(items[0].previousPayments[1]).toMatchObject({
          appointment: null,
          clientPlan: {
            id: "cp1",
            billingType: "INTEGRAL",
            plan: { id: "pl1", name: "Pacote" },
          },
        });
      });

      it("deve ordenar por vencimento, com os sem vencimento por último", async () => {
        setup({ appointments: [visit("a1", "2026-10-10T13:00:00.000Z")] });

        await run();

        expect(prismaMock.payment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: [
              { dueDate: { sort: "asc", nulls: "last" } },
              { createdAt: "asc" },
            ],
          }),
        );
      });
    });

    describe("totais", () => {
      it("deve somar os pendentes de hoje, os anteriores e o pago hoje, com duas casas", async () => {
        const paidAt = new Date("2026-10-10T14:00:00.000Z");
        setup({
          appointments: [
            visit("a1", "2026-10-10T13:00:00.000Z"),
            visit("a2", "2026-10-10T15:00:00.000Z"),
            visit("a3", "2026-10-10T17:00:00.000Z"),
          ],
          payments: [
            ofVisit("p1", "a1", { amount: new Decimal("45.5") }),
            ofVisit("p2", "a2", {
              amount: new Decimal("30"),
              status: "PAID",
              paidAt,
            }),
            // Pago em outro dia: aparece no atendimento, mas não entra em nenhum total.
            ofVisit("p3", "a3", {
              amount: new Decimal("99"),
              status: "PAID",
              paidAt: new Date("2026-10-09T10:00:00.000Z"),
            }),
            ofVisit("p4", "a0", {
              amount: new Decimal("20.25"),
              dueDate: new Date("2026-10-01"),
            }),
            ofPlan("p5", "INTEGRAL", {
              amount: new Decimal("200"),
              dueDate: null,
            }),
            ofPlan("p6", "MONTHLY", {
              amount: new Decimal("10"),
              status: "PAID",
              paidAt,
            }),
          ],
        });

        const { items } = await run();

        expect(items[0].todayPending).toBe("45.50");
        expect(items[0].previousPending).toBe("220.25");
        // p2 (atendimento) + p6 (anterior), ambos pagos hoje.
        expect(items[0].paidToday).toBe("40.00");
        expect(items[0].appointments[2].payment?.status).toBe("PAID");
      });

      it("deve zerar os totais de um cliente sem pagamentos", async () => {
        setup({ appointments: [visit("a1", "2026-10-10T13:00:00.000Z")] });

        const { items } = await run();

        expect(items[0]).toMatchObject({
          todayPending: "0.00",
          previousPending: "0.00",
          paidToday: "0.00",
        });
      });

      it("deve manter cada cliente com os próprios atendimentos e pagamentos", async () => {
        setup({
          clients: [ana, { id: "c2", name: "Bia" }],
          appointments: [
            visit("a1", "2026-10-10T13:00:00.000Z"),
            visit("a2", "2026-10-10T14:00:00.000Z", { clientId: "c2" }),
          ],
          payments: [
            ofVisit("p1", "a1"),
            charge("p2", {
              appointmentId: "a2",
              appointment: {
                id: "a2",
                clientId: "c2",
                startAt: new Date("2026-10-10T14:00:00.000Z"),
                recurringAppointmentId: null,
                service: { id: "s1", name: "Corte" },
              },
            }),
          ],
        });

        const { items } = await run();

        expect(items.map((i) => i.client.id)).toEqual(["c1", "c2"]);
        expect(items[0].appointments.map((a) => a.id)).toEqual(["a1"]);
        expect(items[1].appointments.map((a) => a.id)).toEqual(["a2"]);
        expect(items[1].appointments[0].payment?.id).toBe("p2");
      });
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
