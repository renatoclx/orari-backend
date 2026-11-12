import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import type { PrismaService } from "../../prisma/prisma.service";
import { FindProfessionalClientsQueryDto } from "./dto/find-professional-clients-query.dto";
import { ProfessionalClientsService } from "./professional-clients.service";
import { ProfessionalLinkService } from "./professional-link.service";

const user = {
  id: "user-1",
  companyId: "company-1",
  type: "PROFESSIONAL",
} as AuthenticatedUser;
const NOW = new Date("2026-11-12T13:00:00.000Z");

const query = (extra: Partial<FindProfessionalClientsQueryDto> = {}) =>
  Object.assign(new FindProfessionalClientsQueryDto(), extra);

// Argumento da consulta que o service montou (o mock o guarda como any).
type Args = {
  where: Record<string, unknown>;
  select?: Record<string, unknown>;
};
const argsOf = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls[0][0] as Args;

describe("ProfessionalClientsService", () => {
  const prismaMock = {
    $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    user: { findFirst: vi.fn() },
    people: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    appointment: { findMany: vi.fn(), findFirst: vi.fn() },
  };
  const service = new ProfessionalClientsService(
    prismaMock as unknown as PrismaService,
    new ProfessionalLinkService(prismaMock as unknown as PrismaService),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findFirst.mockResolvedValue({
      people: { id: "pro-1", type: "PROFESSIONAL", deletedAt: null },
    });
    prismaMock.people.findMany.mockResolvedValue([]);
    prismaMock.people.count.mockResolvedValue(0);
    prismaMock.appointment.findMany.mockResolvedValue([]);
  });

  describe("findAll", () => {
    it("lista só clientes ativos com agendamento não cancelado com ele", async () => {
      await service.findAll(user, query(), NOW);

      const { where } = argsOf(prismaMock.people.findMany);
      expect(where).toMatchObject({
        companyId: "company-1",
        type: "CLIENT",
        deletedAt: null,
        appointmentsAsClient: {
          some: { professionalId: "pro-1", status: { not: "CANCELLED" } },
        },
      });
    });

    it("busca pelo nome sem acento nem maiúsculas", async () => {
      await service.findAll(user, query({ search: "  JOÃO " }), NOW);
      expect(argsOf(prismaMock.people.findMany).where).toMatchObject({
        normalizedName: { contains: "joao" },
      });
    });

    it("traz último atendimento e próximo, e o telefone do contato principal", async () => {
      prismaMock.people.findMany.mockResolvedValue([
        {
          id: "c1",
          name: "Ana",
          photoUrl: "/uploads/people/a.jpg",
          contacts: [{ phone: "11999990000" }],
        },
        { id: "c2", name: "Bia", photoUrl: null, contacts: [] },
      ]);
      prismaMock.people.count.mockResolvedValue(2);
      prismaMock.appointment.findMany
        .mockResolvedValueOnce([
          {
            clientId: "c1",
            startAt: new Date("2026-11-01T12:00:00.000Z"),
            service: { name: "Corte" },
          },
        ])
        .mockResolvedValueOnce([
          { clientId: "c2", startAt: new Date("2026-11-20T12:00:00.000Z") },
        ]);

      const result = await service.findAll(user, query(), NOW);

      expect(result.total).toBe(2);
      expect(result.items[0]).toMatchObject({
        phone: "11999990000",
        lastCompleted: { serviceName: "Corte" },
        nextAt: null,
      });
      expect(result.items[1]).toMatchObject({
        phone: null,
        lastCompleted: null,
        nextAt: new Date("2026-11-20T12:00:00.000Z"),
      });
    });

    it("o último e o próximo só olham os atendimentos dele", async () => {
      prismaMock.people.findMany.mockResolvedValue([
        { id: "c1", name: "Ana", photoUrl: null, contacts: [] },
      ]);
      await service.findAll(user, query(), NOW);
      for (const [args] of prismaMock.appointment.findMany.mock
        .calls as unknown as [Args][]) {
        expect(args.where).toMatchObject({
          professionalId: "pro-1",
          companyId: "company-1",
          clientId: { in: ["c1"] },
        });
      }
    });

    it("recusa quem não tem cadastro de profissional ativo", async () => {
      prismaMock.user.findFirst.mockResolvedValue({ people: null });
      await expect(service.findAll(user, query(), NOW)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe("findOne", () => {
    const person = {
      id: "c1",
      name: "Ana",
      photoUrl: null,
      contacts: [{ phone: "11999990000" }],
    };

    it("cliente que não é da carteira dele responde 404", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);
      await expect(service.findOne(user, "c9", NOW)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // A conferência usa a mesma regra da lista, com o id pedido.
      expect(argsOf(prismaMock.people.findFirst).where).toMatchObject({
        id: "c9",
        appointmentsAsClient: { some: { professionalId: "pro-1" } },
      });
    });

    it("devolve a ficha com o histórico dele, sem pagamento, e o preço em número", async () => {
      prismaMock.people.findFirst.mockResolvedValue(person);
      prismaMock.appointment.findMany.mockResolvedValue([
        {
          id: "a1",
          startAt: NOW,
          endAt: NOW,
          status: "COMPLETED",
          note: "Voltar em 30 dias",
          overBooking: false,
          classSessionId: "sess-1",
          service: {
            id: "s1",
            name: "Pilates",
            color: null,
            duration: 50,
            price: new Decimal("90"),
          },
          recurringAppointment: { clientPlanId: null },
        },
      ]);
      prismaMock.appointment.findFirst
        .mockResolvedValueOnce({ startAt: NOW, service: { name: "Pilates" } })
        .mockResolvedValueOnce(null);

      const result = await service.findOne(user, "c1", NOW);

      expect(result.phone).toBe("11999990000");
      expect(result.lastCompleted).toEqual({
        startAt: NOW,
        serviceName: "Pilates",
      });
      expect(result.nextAt).toBeNull();
      expect(result.history[0]).toMatchObject({
        inClass: true,
        recurrence: { isPackage: false },
        service: { price: 90 },
      });
      expect(result.history[0]).not.toHaveProperty("classSessionId");
      expect(result.history[0]).not.toHaveProperty("payment");
      // Só os atendimentos dele com esse cliente.
      expect(argsOf(prismaMock.appointment.findMany).where).toEqual({
        companyId: "company-1",
        professionalId: "pro-1",
        clientId: "c1",
      });
      expect(argsOf(prismaMock.appointment.findMany).select).not.toHaveProperty(
        "payment",
      );
    });
  });
});
