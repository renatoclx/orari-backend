import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";
import type { PortalAppointmentService } from "./portal-appointment.service";
import type { PortalCompanyService } from "./portal-company.service";
import { PortalPlaceService } from "./portal-place.service";

const ACCOUNT = { sessionId: "s-1", accountId: "acc-1" };
const AURORA = { id: "c-1", name: "Studio Aurora", logoUrl: null };
const at = (iso: string) => ({ startAt: new Date(iso) });

describe("PortalPlaceService", () => {
  const prismaMock = {
    people: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    clientAccount: { findUniqueOrThrow: vi.fn() },
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
    prismaMock.clientAccount.findUniqueOrThrow.mockResolvedValue({
      name: "Ana Souza",
      phone: "31988887777",
    });
  });

  describe("join", () => {
    it("cria um cadastro novo, não confirmado, com o nome e o telefone da conta", async () => {
      prismaMock.people.findFirst.mockResolvedValue(null);

      await expect(service.join(ACCOUNT, "aurora")).resolves.toEqual({
        place: { slug: "aurora", name: "Studio Aurora", logoUrl: null },
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
          contacts: {
            create: { type: "MAIN", phone: "31988887777", isPrincipal: true },
          },
        },
        select: { id: true },
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
});
