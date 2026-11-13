import { Injectable } from "@nestjs/common";
import { PeopleType } from "../../../generated/prisma/enums";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyAccessService } from "../company-access/company-access.service";
import {
  buildOnboarding,
  ONBOARDING_STEPS,
  type OnboardingState,
  type OnboardingStepKey,
} from "./onboarding-steps";

/**
 * Os primeiros passos da clínica nova (a lista do Dashboard) e a dispensa do
 * aviso de boas-vindas. Cada passo sai dos dados que já existem: nada novo para
 * gravar, e o passo some sozinho quando é feito. Só entram os passos cuja
 * funcionalidade o plano libera.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CompanyAccessService,
  ) {}

  /** A lista da clínica do usuário, com o que já foi feito. */
  async find(user: AuthenticatedUser): Promise<OnboardingState> {
    const { companyId } = user;
    const dismissed = await this.dismissed(user.id);

    const planned = [];
    for (const step of ONBOARDING_STEPS) {
      if (await this.access.can(companyId, step.feature, "view")) {
        planned.push(step);
      }
    }
    const done = await Promise.all(
      planned.map((step) => this.isDone(step.key, companyId)),
    );
    return buildOnboarding(
      planned.map((step, index) => ({
        key: step.key,
        optional: step.optional,
        done: done[index],
      })),
      dismissed,
    );
  }

  /** Dispensa a lista (ADMIN) ou o cartão de boas-vindas (PROFESSIONAL), só para quem pediu. */
  async dismiss(user: AuthenticatedUser): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: user.id, onboardingDismissedAt: null },
      data: { onboardingDismissedAt: new Date() },
    });
  }

  /** O cartão de boas-vindas do app já foi dispensado? */
  async dismissed(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { onboardingDismissedAt: true },
    });
    return user?.onboardingDismissedAt != null;
  }

  private async isDone(
    key: OnboardingStepKey,
    companyId: string,
  ): Promise<boolean> {
    switch (key) {
      case "BUSINESS_HOURS":
        return (
          (await this.prisma.businessHour.count({
            where: { companyId, deletedAt: null },
          })) > 0
        );
      case "LOGO":
        return (
          (await this.prisma.company.count({
            where: { id: companyId, logoUrl: { not: null } },
          })) > 0
        );
      case "SERVICE":
        return (
          (await this.prisma.service.count({
            where: { companyId, deletedAt: null },
          })) > 0
        );
      case "PROFESSIONAL":
        return this.hasPeople(companyId, PeopleType.PROFESSIONAL);
      case "CLIENT":
        return this.hasPeople(companyId, PeopleType.CLIENT);
      case "APPOINTMENT":
        return (
          (await this.prisma.appointment.count({ where: { companyId } })) > 0
        );
      case "PORTAL":
        return (
          (await this.prisma.portalSettings.count({
            where: { companyId, enabled: true },
          })) > 0
        );
    }
  }

  private async hasPeople(
    companyId: string,
    type: PeopleType,
  ): Promise<boolean> {
    return (
      (await this.prisma.people.count({
        where: { companyId, type, deletedAt: null },
      })) > 0
    );
  }
}
