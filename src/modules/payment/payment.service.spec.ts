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
import { AppointmentService } from "../appointment/appointment.service";
import { PaymentMethodService } from "../payment-method/payment-method.service";
import { ServiceService } from "../service/service.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { PaymentService } from "./payment.service";

const anyDate: unknown = expect.any(Date);

// Filtro esperado de "pagamento da empresa": a empresa fica no próprio pagamento.
const ownedByCompany = { companyId: COMPANY_ID };

describe("PaymentService", () => {
  let paymentService: PaymentService;
  const prismaMock = {
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    payment: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const appointmentServiceMock = { findOne: vi.fn() };
  const paymentMethodServiceMock = { findOne: vi.fn() };
  const serviceServiceMock = { findOne: vi.fn() };

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
    appointmentServiceMock.findOne.mockResolvedValue({
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
      ],
    }).compile();

    paymentService = module.get<PaymentService>(PaymentService);
  });

  describe("create", () => {
    it("deve validar agendamento e método e criar como PENDING", async () => {
      prismaMock.payment.create.mockResolvedValue(payment);

      await paymentService.create(dto, COMPANY_ID);

      expect(appointmentServiceMock.findOne).toHaveBeenCalledWith(
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
      appointmentServiceMock.findOne.mockRejectedValueOnce(
        new NotFoundException(),
      );

      await expect(
        paymentService.create(dto, COMPANY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
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
    it("deve restringir à empresa do pagamento e aplicar os filtros", async () => {
      prismaMock.payment.findMany.mockResolvedValue([payment]);
      prismaMock.payment.count.mockResolvedValue(1);

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
        },
      });
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
});
