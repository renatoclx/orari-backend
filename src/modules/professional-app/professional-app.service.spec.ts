import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyService } from "../company/company.service";
import { ProfessionalAppService } from "./professional-app.service";
import { ProfessionalLinkService } from "./professional-link.service";

const user = {
  id: "user-1",
  companyId: "company-1",
  type: "PROFESSIONAL",
} as AuthenticatedUser;
// 12/11/2026 às 10:00 no relógio da empresa (UTC-3).
const NOW = new Date("2026-11-12T13:00:00.000Z");

// Argumento da consulta que o service montou (o mock guarda como any).
type FindManyArgs = {
  where: { professionalId: string; companyId: string; startAt: unknown };
  select: Record<string, unknown> & { client: { select: unknown } };
};
const lastQuery = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls[0][0] as FindManyArgs;

describe("ProfessionalAppService", () => {
  const prismaMock = {
    user: { findFirst: vi.fn() },
    appointment: { findMany: vi.fn() },
    agendaBlock: { findMany: vi.fn() },
  };
  const companyMock = { getTimeZone: vi.fn() };
  const service = new ProfessionalAppService(
    prismaMock as unknown as PrismaService,
    companyMock as unknown as CompanyService,
    new ProfessionalLinkService(prismaMock as unknown as PrismaService),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    companyMock.getTimeZone.mockResolvedValue("America/Sao_Paulo");
    prismaMock.user.findFirst.mockResolvedValue({
      people: { id: "pro-1", type: "PROFESSIONAL", deletedAt: null },
    });
    prismaMock.appointment.findMany.mockResolvedValue([]);
    prismaMock.agendaBlock.findMany.mockResolvedValue([]);
  });

  it("filtra pelo profissional do vínculo e pelo dia da empresa", async () => {
    const result = await service.findAgenda(user, "2026-11-12");

    expect(result.day).toBe("2026-11-12");
    const { where } = lastQuery(prismaMock.appointment.findMany);
    expect(where.professionalId).toBe("pro-1");
    expect(where.companyId).toBe("company-1");
    // 00:00 em UTC-3 até 00:00 do dia seguinte.
    expect(where.startAt).toEqual({
      gte: new Date("2026-11-12T03:00:00.000Z"),
      lt: new Date("2026-11-13T03:00:00.000Z"),
    });
  });

  it("sem o dia, usa hoje no relógio da empresa", async () => {
    // 01:00 UTC do dia 13 ainda é dia 12 em São Paulo.
    const result = await service.findAgenda(
      user,
      undefined,
      new Date("2026-11-13T01:00:00.000Z"),
    );
    expect(result.day).toBe("2026-11-12");
  });

  it("devolve só os campos da tela, com preço em número e a origem", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([
      {
        id: "a1",
        startAt: NOW,
        endAt: NOW,
        status: "SCHEDULED",
        note: null,
        overBooking: false,
        client: { id: "c1", name: "Ana" },
        service: {
          id: "s1",
          name: "Corte",
          color: "#fff",
          duration: 30,
          price: new Decimal("45.5"),
        },
        recurringAppointment: { clientPlanId: "plan-1" },
        classSession: null,
      },
    ]);

    const { appointments } = await service.findAgenda(user, "2026-11-12");

    expect(appointments[0].service.price).toBe(45.5);
    expect(appointments[0].recurrence).toEqual({ isPackage: true });
    expect(appointments[0]).not.toHaveProperty("payment");
    expect(appointments[0]).not.toHaveProperty("recurringAppointment");
  });

  it("serviço sem preço e agendamento avulso", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([
      {
        id: "a1",
        service: { price: null },
        recurringAppointment: null,
      },
    ]);
    const { appointments } = await service.findAgenda(user, "2026-11-12");
    expect(appointments[0].service.price).toBeNull();
    expect(appointments[0].recurrence).toBeNull();
  });

  it("não pede nenhum dado de pagamento nem de contato do cliente", async () => {
    await service.findAgenda(user, "2026-11-12");
    const { select } = lastQuery(prismaMock.appointment.findMany);
    expect(select).not.toHaveProperty("payment");
    expect(select).not.toHaveProperty("commission");
    expect(select.client.select).toEqual({ id: true, name: true });
  });

  it("recusa um dia que não existe", async () => {
    await expect(service.findAgenda(user, "2026-02-31")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("recusa quando o cadastro do profissional foi inativado", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      people: { id: "pro-1", type: "PROFESSIONAL", deletedAt: new Date() },
    });
    await expect(service.findAgenda(user, "2026-11-12")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
  });

  it("recusa o usuário sem pessoa vinculada ou vinculado a funcionário", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ people: null });
    await expect(service.findAgenda(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    prismaMock.user.findFirst.mockResolvedValue({
      people: { id: "e1", type: "EMPLOYEE", deletedAt: null },
    });
    await expect(service.findAgenda(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
