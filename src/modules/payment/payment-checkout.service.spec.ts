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
import { PaymentMethodService } from "../payment-method/payment-method.service";
import { PaymentCheckoutService } from "./payment-checkout.service";

const anyDate: unknown = expect.any(Date);

// Filtro esperado de "pagamento da empresa": a empresa fica no próprio pagamento.
const ownedByCompany = { companyId: COMPANY_ID };

describe("PaymentCheckoutService", () => {
  let checkoutService: PaymentCheckoutService;
  const prismaMock: Record<string, unknown> & {
    payment: Record<string, ReturnType<typeof vi.fn>>;
    people: Record<string, ReturnType<typeof vi.fn>>;
    appointment: Record<string, ReturnType<typeof vi.fn>>;
    productSale: Record<string, ReturnType<typeof vi.fn>>;
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
    // Vendas de produtos do dia (comanda); vazio quando o teste não diz.
    productSale: { findMany: vi.fn() },
    payment: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const paymentMethodServiceMock = { findOne: vi.fn() };
  // "Hoje" da comanda: os testes usam UTC e um relógio fixo.
  const companyServiceMock = { getTimeZone: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-10-10T12:00:00.000Z"));
    companyServiceMock.getTimeZone.mockResolvedValue("UTC");
    prismaMock.productSale.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentCheckoutService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PaymentMethodService, useValue: paymentMethodServiceMock },
        { provide: CompanyService, useValue: companyServiceMock },
      ],
    }).compile();

    checkoutService = module.get(PaymentCheckoutService);
  });

  afterEach(() => {
    vi.useRealTimers();
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
      checkoutService.findCheckouts(
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
            // Comprou hoje (venda não cancelada) ou pagou hoje uma venda.
            {
              productSales: {
                some: {
                  createdAt: { gte: dayStart, lt: dayEnd },
                  cancelledAt: null,
                },
              },
            },
            { productSales: { some: { payment: { is: paidToday } } } },
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

    describe("vendas de produtos", () => {
      const items = [
        {
          quantity: 2,
          unitPrice: new Decimal("25"),
          product: { id: "pr1", name: "Sérum" },
        },
      ];
      // Pagamento de uma venda do cliente c1.
      const ofSale = (id: string, saleId: string, extra: object = {}) =>
        charge(id, {
          productSaleId: saleId,
          productSale: {
            id: saleId,
            clientId: "c1",
            createdAt: new Date("2026-10-08T15:00:00.000Z"),
            items,
          },
          ...extra,
        });

      it("deve mostrar as vendas de hoje em seção própria e somar nos totais de hoje", async () => {
        setup({
          payments: [
            // A da venda de hoje vem pela consulta, mas fica na seção da venda.
            ofSale("p-today", "sale-today", { amount: new Decimal("50") }),
            // Venda de outro dia, ainda pendente: vai para os anteriores.
            ofSale("p-old", "sale-old", {
              amount: new Decimal("30"),
              dueDate: new Date("2026-10-08"),
            }),
          ],
        });
        prismaMock.productSale.findMany.mockResolvedValue([
          {
            id: "sale-today",
            clientId: "c1",
            createdAt: new Date("2026-10-10T14:00:00.000Z"),
            items,
            payment: {
              id: "p-today",
              amount: new Decimal("50"),
              dueDate: today,
              status: "PENDING",
              paidAt: null,
              paymentMethod: null,
            },
          },
        ]);

        const { items: checkouts } = await run();

        expect(prismaMock.productSale.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              companyId: COMPANY_ID,
              clientId: { in: ["c1"] },
              createdAt: { gte: dayStart, lt: dayEnd },
              cancelledAt: null,
            },
          }),
        );
        const [checkout] = checkouts;
        const salePayment: unknown = expect.objectContaining({
          id: "p-today",
          status: "PENDING",
        });
        expect(checkout.productSales).toEqual([
          expect.objectContaining({
            id: "sale-today",
            items,
            payment: salePayment,
          }),
        ]);
        expect(checkout.previousPayments.map((payment) => payment.id)).toEqual([
          "p-old",
        ]);
        expect(checkout.previousPayments[0].productSale).toEqual({
          id: "sale-old",
          createdAt: new Date("2026-10-08T15:00:00.000Z"),
          items,
        });
        expect(checkout.todayPending).toBe("50.00");
        expect(checkout.previousPending).toBe("30.00");
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
      const result = await checkoutService.settle(body, COMPANY_ID);

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
        checkoutService.settle({ ...body, paidAt }, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });

    it("deve aceitar paidAt passado (baixa esquecida) e o instante atual", async () => {
      await expect(
        checkoutService.settle(
          { ...body, paidAt: new Date("2026-09-01T10:00:00.000Z") },
          COMPANY_ID,
        ),
      ).resolves.toEqual({ settled: 2 });
      await expect(
        checkoutService.settle(
          { ...body, paidAt: new Date("2026-10-10T12:00:00.000Z") },
          COMPANY_ID,
        ),
      ).resolves.toEqual({ settled: 2 });
    });

    it("deve usar o paidAt informado", async () => {
      const paidAt = new Date("2026-10-09T15:00:00.000Z");

      await checkoutService.settle({ ...body, paidAt }, COMPANY_ID);

      expect(prismaMock.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paidAt }) as unknown,
        }),
      );
    });

    it("deve lançar NotFoundException quando algum pagamento não é da empresa", async () => {
      prismaMock.payment.findMany.mockResolvedValue([pending("c1")]);

      await expect(
        checkoutService.settle(body, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });

    it("deve lançar NotFoundException para método inexistente na empresa", async () => {
      paymentMethodServiceMock.findOne.mockRejectedValueOnce(
        new NotFoundException(),
      );

      await expect(
        checkoutService.settle(body, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });

    it("deve lançar ConflictException quando algum não está PENDING", async () => {
      prismaMock.payment.findMany.mockResolvedValue([
        pending("c1"),
        pending("c1", "PAID"),
      ]);

      await expect(
        checkoutService.settle(body, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });

    it("deve lançar BadRequestException para clientes diferentes", async () => {
      prismaMock.payment.findMany.mockResolvedValue([
        pending("c1"),
        pending("c2"),
      ]);

      await expect(
        checkoutService.settle(body, COMPANY_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
    });

    describe("atendimento recebido antes da conclusão", () => {
      const visit = (overrides: Record<string, unknown> = {}) => ({
        id: "a1",
        clientId: "c1",
        startAt: new Date("2026-10-10T15:00:00.000Z"),
        status: "SCHEDULED",
        service: { price: new Decimal("80") },
        recurringAppointment: null,
        payment: null,
        ...overrides,
      });
      const ahead = { ...body, appointmentIds: ["a1"] };

      beforeEach(() => {
        prismaMock.appointment.findMany.mockResolvedValue([visit()]);
        prismaMock.payment.createMany.mockResolvedValue({ count: 1 });
      });

      it("cria o pagamento já pago, com o preço do serviço e o vencimento no dia", async () => {
        await expect(
          checkoutService.settle(ahead, COMPANY_ID),
        ).resolves.toEqual({ settled: 3 });
        expect(prismaMock.payment.createMany).toHaveBeenCalledWith({
          data: [
            {
              companyId: COMPANY_ID,
              appointmentId: "a1",
              amount: new Decimal("80"),
              dueDate: new Date("2026-10-10T00:00:00.000Z"),
              status: "PAID",
              paymentMethodId: "method-1",
              paidAt: new Date("2026-10-10T12:00:00.000Z"),
            },
          ],
        });
      });

      it("aceita só atendimentos, sem pagamento pendente junto", async () => {
        await expect(
          checkoutService.settle(
            {
              paymentIds: [],
              appointmentIds: ["a1"],
              paymentMethodId: "method-1",
            },
            COMPANY_ID,
          ),
        ).resolves.toEqual({ settled: 1 });
        expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
      });

      it("recusa a baixa sem nenhum item", async () => {
        await expect(
          checkoutService.settle(
            { paymentIds: [], appointmentIds: [], paymentMethodId: "method-1" },
            COMPANY_ID,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it.each([
        ["cancelado", { status: "CANCELLED" }, ConflictException],
        ["com falta", { status: "NO_SHOW" }, ConflictException],
        [
          "sessão de pacote",
          { recurringAppointment: { clientPlanId: "plan-1" } },
          ConflictException,
        ],
        [
          "já com pagamento",
          { payment: { deletedAt: null } },
          ConflictException,
        ],
        [
          "serviço sem preço",
          { service: { price: null } },
          BadRequestException,
        ],
      ])(
        "recusa atendimento %s sem gravar nada",
        async (_, overrides, error) => {
          prismaMock.appointment.findMany.mockResolvedValue([visit(overrides)]);

          await expect(
            checkoutService.settle(ahead, COMPANY_ID),
          ).rejects.toBeInstanceOf(error);
          expect(prismaMock.payment.updateMany).not.toHaveBeenCalled();
          expect(prismaMock.payment.createMany).not.toHaveBeenCalled();
        },
      );

      it("aceita quando o pagamento anterior foi excluído", async () => {
        prismaMock.appointment.findMany.mockResolvedValue([
          visit({ payment: { deletedAt: new Date() } }),
        ]);
        await expect(
          checkoutService.settle(ahead, COMPANY_ID),
        ).resolves.toEqual({ settled: 3 });
      });

      it("404 para atendimento de outra empresa", async () => {
        prismaMock.appointment.findMany.mockResolvedValue([]);
        await expect(
          checkoutService.settle(ahead, COMPANY_ID),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it("recusa atendimento de outro cliente", async () => {
        prismaMock.appointment.findMany.mockResolvedValue([
          visit({ clientId: "c2" }),
        ]);
        await expect(
          checkoutService.settle(ahead, COMPANY_ID),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    it("deve lançar ConflictException se uma baixa concorrente tirou algum do PENDING", async () => {
      prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        checkoutService.settle(body, COMPANY_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
