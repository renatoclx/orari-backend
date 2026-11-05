import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";
import type { PortalAppointmentService } from "./portal-appointment.service";
import type { PortalCompanyService } from "./portal-company.service";
import { PortalPlaceService } from "./portal-place.service";

const ACCOUNT = { sessionId: "s-1", accountId: "acc-1" };
const AURORA = {
  id: "c-1",
  name: "Studio Aurora",
  logoUrl: null,
  timezone: "America/Sao_Paulo",
};
const at = (iso: string) => ({ startAt: new Date(iso) });
const profile = (overrides: object = {}) => ({
  name: "Ana Souza",
  phone: "31988887777",
  email: null,
  document: null,
  birthDate: null,
  profession: null,
  addressCep: null,
  addressStreet: null,
  addressNumber: null,
  addressComplement: null,
  addressNeighborhood: null,
  addressCityId: null,
  ...overrides,
});

describe("PortalPlaceService", () => {
  const prismaMock = {
    people: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    clientAccount: { findUniqueOrThrow: vi.fn() },
    clientPlan: { findMany: vi.fn() },
    recurringAppointment: { findMany: vi.fn() },
  };
  const companyMock = { findBySlug: vi.fn() };
  const appointmentsMock = { list: vi.fn() };
  const service = new PortalPlaceService(
    prismaMock as unknown as PrismaService,
    companyMock as unknown as PortalCompanyService,
    appointmentsMock as unknown as PortalAppointmentService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    companyMock.findBySlug.mockResolvedValue(AURORA);
    prismaMock.clientAccount.findUniqueOrThrow.mockResolvedValue(profile());
    prismaMock.people.count.mockResolvedValue(0);
  });

  describe("join", () => {
    it("cria um cadastro novo, não confirmado, com os dados da conta", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);

      await expect(service.join(ACCOUNT, "aurora")).resolves.toEqual({
        place: {
          slug: "aurora",
          name: "Studio Aurora",
          logoUrl: null,
          timezone: "America/Sao_Paulo",
        },
        joined: true,
      });
      expect(prismaMock.people.create).toHaveBeenCalledWith({
        data: {
          name: "Ana Souza",
          normalizedName: "ana souza",
          type: "CLIENT",
          companyId: "c-1",
          clientAccountId: "acc-1",
          portalConfirmed: false,
          document: null,
          birthDate: null,
          profession: null,
          contacts: {
            create: {
              type: "MAIN",
              phone: "31988887777",
              email: null,
              isPrincipal: true,
            },
          },
        },
        select: { id: true },
      });
    });

    it("com CPF e endereço na conta: vão junto; CPF já usado na clínica fica de fora", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);
      prismaMock.clientAccount.findUniqueOrThrow.mockResolvedValue(
        profile({
          document: "12345678909",
          addressCep: "30110000",
          addressStreet: "Rua A",
          addressNumber: "10",
          addressCityId: "city-1",
        }),
      );
      prismaMock.people.count.mockResolvedValue(1);

      await service.join(ACCOUNT, "aurora");

      const [{ data }] = prismaMock.people.create.mock.calls[0] as [
        { data: { document: string | null; addresses?: unknown } },
      ];
      expect(prismaMock.people.count).toHaveBeenCalledWith({
        where: { companyId: "c-1", document: "12345678909", deletedAt: null },
      });
      expect(data.document).toBeNull();
      expect(data.addresses).toEqual({
        create: {
          type: "MAIN",
          cep: "30110000",
          street: "Rua A",
          number: "10",
          complement: null,
          neighborhood: null,
          cityId: "city-1",
          isPrincipal: true,
        },
      });
    });

    it("procura só o cadastro ativo da própria conta (nunca pelo telefone)", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);
      await service.join(ACCOUNT, "aurora");
      expect(prismaMock.people.findFirst).toHaveBeenCalledWith({
        where: {
          companyId: "c-1",
          clientAccountId: "acc-1",
          type: "CLIENT",
          deletedAt: null,
        },
        select: { id: true },
      });
    });

    it("já é cliente: não cria outro", async () => {
      prismaMock.people.findFirst.mockResolvedValue({ id: "cli-1" });
      await expect(service.join(ACCOUNT, "aurora")).resolves.toMatchObject({
        joined: false,
      });
      expect(prismaMock.people.create).not.toHaveBeenCalled();
    });

    it("dois toques ao mesmo tempo: o índice único deixa um só, sem erro", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);
      prismaMock.people.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("único", {
          code: "P2002",
          clientVersion: "7",
        }),
      );
      await expect(service.join(ACCOUNT, "aurora")).resolves.toMatchObject({
        joined: false,
      });
    });

    it("portal fechado: 404, sem criar", async () => {
      companyMock.findBySlug.mockRejectedValue(new NotFoundException());
      await expect(service.join(ACCOUNT, "aurora")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prismaMock.people.create).not.toHaveBeenCalled();
    });
  });

  describe("appointments", () => {
    it("junta os locais abertos, com o local em cada item, em ordem de data", async () => {
      prismaMock.people.findMany.mockResolvedValue([
        { id: "cli-1", companyId: "c-1", company: { subdomain: "aurora" } },
        { id: "cli-2", companyId: "c-2", company: { subdomain: "zeta" } },
        { id: "cli-3", companyId: "c-3", company: { subdomain: "fechada" } },
      ]);
      companyMock.findBySlug.mockImplementation((slug: string) =>
        slug === "fechada"
          ? Promise.reject(new NotFoundException())
          : Promise.resolve({
              id: slug === "aurora" ? "c-1" : "c-2",
              name: slug === "aurora" ? "Aurora" : "Zeta",
              logoUrl: null,
            }),
      );
      appointmentsMock.list.mockImplementation(
        (_company: unknown, client: { peopleId: string }) =>
          Promise.resolve(
            client.peopleId === "cli-1"
              ? {
                  upcoming: [at("2026-11-20T12:00:00Z")],
                  past: [at("2026-11-01T12:00:00Z")],
                }
              : {
                  upcoming: [at("2026-11-10T12:00:00Z")],
                  past: [at("2026-11-03T12:00:00Z")],
                },
          ),
      );

      const result = await service.appointments(ACCOUNT);

      expect(result.upcoming.map((item) => item.place.name)).toEqual([
        "Zeta",
        "Aurora",
      ]);
      expect(result.past.map((item) => item.place.name)).toEqual([
        "Zeta",
        "Aurora",
      ]);
      expect(appointmentsMock.list).toHaveBeenCalledTimes(2);
      expect(appointmentsMock.list).toHaveBeenCalledWith(
        expect.objectContaining({ id: "c-1" }),
        { ...ACCOUNT, companyId: "c-1", peopleId: "cli-1" },
        expect.any(Date),
      );
    });
  });

  describe("pacotes e recorrências (só para ver)", () => {
    const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

    beforeEach(() => {
      prismaMock.people.findMany.mockResolvedValue([
        { id: "cli-1", company: { subdomain: "aurora" } },
        { id: "cli-3", company: { subdomain: "fechada" } },
      ]);
      companyMock.findBySlug.mockImplementation((slug: string) =>
        slug === "fechada"
          ? Promise.reject(new NotFoundException())
          : Promise.resolve(AURORA),
      );
    });

    it("pacotes: situação pela mesma regra da clínica, ativos primeiro, sem valores", async () => {
      prismaMock.clientPlan.findMany.mockResolvedValue([
        {
          id: "cp-1",
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-03-31"),
          cancelledAt: null,
          plan: { name: "Trimestral" },
        },
        {
          id: "cp-2",
          startDate: new Date("2026-10-01"),
          endDate: new Date("2099-12-31"),
          cancelledAt: null,
          plan: { name: "Anual" },
        },
        {
          id: "cp-3",
          startDate: new Date("2026-09-01"),
          endDate: new Date("2099-12-31"),
          cancelledAt: new Date(),
          plan: { name: "Mensal" },
        },
      ]);

      const result = await service.plans(ACCOUNT);

      expect(result.map((item) => [item.planName, item.status])).toEqual([
        ["Anual", "active"],
        ["Mensal", "cancelled"],
        ["Trimestral", "finished"],
      ]);
      expect(result[0]).toEqual({
        id: "cp-2",
        planName: "Anual",
        startDate: "2026-10-01",
        endDate: "2099-12-31",
        status: "active",
        place: {
          slug: "aurora",
          name: "Studio Aurora",
          logoUrl: null,
          timezone: "America/Sao_Paulo",
        },
      });
      // Só o estabelecimento de portal aberto é consultado.
      expect(prismaMock.clientPlan.findMany).toHaveBeenCalledTimes(1);
    });

    it("recorrências: só as em vigor, com o tipo e os dias em HH:MM", async () => {
      prismaMock.recurringAppointment.findMany.mockResolvedValue([
        {
          id: "r-1",
          startDate: new Date("2026-10-01"),
          endDate: null,
          clientPlanId: null,
          classGroupId: "cg-1",
          service: { name: "Pilates" },
          professional: { name: "Camila" },
          days: [
            {
              weekDay: "TUESDAY",
              startTime: time("09:00"),
              endTime: time("10:00"),
            },
          ],
        },
      ]);

      const [item] = await service.recurrences(ACCOUNT);

      expect(item).toMatchObject({
        kind: "CLASS",
        startDate: "2026-10-01",
        endDate: null,
        days: [{ weekDay: "TUESDAY", startTime: "09:00", endTime: "10:00" }],
      });
      expect(prismaMock.recurringAppointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            clientId: "cli-1",
            isActive: true,
            classLeftAt: null,
          }) as unknown,
        }),
      );
    });
  });
});
