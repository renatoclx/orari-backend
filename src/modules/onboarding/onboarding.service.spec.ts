import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyAccessService } from "../company-access/company-access.service";
import { OnboardingService } from "./onboarding.service";

const user = {
  id: "user-1",
  companyId: "company-1",
  type: "ADMIN",
} as AuthenticatedUser;

describe("OnboardingService", () => {
  const prismaMock = {
    user: { findUnique: vi.fn(), updateMany: vi.fn() },
    businessHour: { count: vi.fn() },
    company: { count: vi.fn() },
    service: { count: vi.fn() },
    people: { count: vi.fn() },
    appointment: { count: vi.fn() },
    portalSettings: { count: vi.fn() },
  };
  const accessMock = { can: vi.fn() };
  const service = new OnboardingService(
    prismaMock as unknown as PrismaService,
    accessMock as unknown as CompanyAccessService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    accessMock.can.mockResolvedValue(true);
    prismaMock.user.findUnique.mockResolvedValue({
      onboardingDismissedAt: null,
    });
    for (const model of [
      prismaMock.businessHour,
      prismaMock.company,
      prismaMock.service,
      prismaMock.people,
      prismaMock.appointment,
      prismaMock.portalSettings,
    ]) {
      model.count.mockResolvedValue(0);
    }
  });

  it("clínica nova: nada feito, seis passos obrigatórios e o portal opcional", async () => {
    const state = await service.find(user);
    expect(state.steps.map((step) => [step.key, step.done])).toEqual([
      ["BUSINESS_HOURS", false],
      ["LOGO", false],
      ["SERVICE", false],
      ["PROFESSIONAL", false],
      ["CLIENT", false],
      ["APPOINTMENT", false],
      ["PORTAL", false],
    ]);
    expect(state).toMatchObject({ completed: 0, total: 6, dismissed: false });
  });

  it("cada passo sai dos dados da própria clínica", async () => {
    prismaMock.service.count.mockResolvedValue(2);
    prismaMock.appointment.count.mockResolvedValue(1);
    prismaMock.portalSettings.count.mockResolvedValue(1);
    const state = await service.find(user);
    const done = Object.fromEntries(state.steps.map((s) => [s.key, s.done]));
    expect(done).toMatchObject({
      SERVICE: true,
      APPOINTMENT: true,
      PORTAL: true,
    });
    expect(state.completed).toBe(2);
    expect(prismaMock.service.count).toHaveBeenCalledWith({
      where: { companyId: "company-1", deletedAt: null },
    });
    expect(prismaMock.company.count).toHaveBeenCalledWith({
      where: { id: "company-1", logoUrl: { not: null } },
    });
  });

  it("profissional e cliente são pessoas ativas do tipo certo", async () => {
    await service.find(user);
    expect(prismaMock.people.count).toHaveBeenCalledWith({
      where: { companyId: "company-1", type: "PROFESSIONAL", deletedAt: null },
    });
    expect(prismaMock.people.count).toHaveBeenCalledWith({
      where: { companyId: "company-1", type: "CLIENT", deletedAt: null },
    });
  });

  it("só entram os passos cuja funcionalidade o plano libera", async () => {
    accessMock.can.mockImplementation((_company: string, feature: string) =>
      Promise.resolve(feature !== "client-portal" && feature !== "services"),
    );
    const state = await service.find(user);
    const keys = state.steps.map((step) => step.key);
    expect(keys).not.toContain("PORTAL");
    expect(keys).not.toContain("SERVICE");
    expect(state.total).toBe(5);
    expect(prismaMock.portalSettings.count).not.toHaveBeenCalled();
  });

  it("diz se o usuário dispensou", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      onboardingDismissedAt: new Date(),
    });
    expect((await service.find(user)).dismissed).toBe(true);
    expect(await service.dismissed("user-1")).toBe(true);
  });

  it("dispensar marca só o próprio usuário, e só uma vez", async () => {
    await service.dismiss(user);
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", onboardingDismissedAt: null },
      data: { onboardingDismissedAt: expect.any(Date) as Date },
    });
  });
});
