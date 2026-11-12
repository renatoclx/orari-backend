import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyService } from "../company/company.service";
import { ProfessionalHomeService } from "./professional-home.service";
import { ProfessionalLinkService } from "./professional-link.service";

const user = { id: "user-1", companyId: "company-1" } as AuthenticatedUser;
const NOW = new Date("2026-11-12T13:00:00.000Z");

describe("ProfessionalHomeService", () => {
  const prismaMock = {
    user: {
      findFirst: vi.fn().mockResolvedValue({
        people: { id: "pro-1", type: "PROFESSIONAL", deletedAt: null },
      }),
    },
    appointment: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const companyMock = {
    getTimeZone: vi.fn().mockResolvedValue("America/Sao_Paulo"),
  };
  const service = new ProfessionalHomeService(
    prismaMock as unknown as PrismaService,
    companyMock as unknown as CompanyService,
    new ProfessionalLinkService(prismaMock as unknown as PrismaService),
  );

  it("consulta só os agendamentos do profissional do vínculo, sem pagamento", async () => {
    const result = await service.find(user, NOW);

    expect(result.today.total).toBe(0);
    const calls = prismaMock.appointment.findMany.mock.calls as unknown as [
      { where: Record<string, unknown>; select: Record<string, unknown> },
    ][];
    expect(calls).toHaveLength(2);
    for (const [args] of calls) {
      expect(args.where).toMatchObject({
        companyId: "company-1",
        professionalId: "pro-1",
      });
      expect(args.select).not.toHaveProperty("payment");
    }
    // A segunda consulta é a dos próximos: só o que ainda vai acontecer.
    expect(calls[1][0].where).toMatchObject({
      status: { in: ["SCHEDULED", "CONFIRMED"] },
    });
  });
});
