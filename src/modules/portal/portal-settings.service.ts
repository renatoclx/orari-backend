import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { UpdatePortalSettingsDto } from "./dto/update-portal-settings.dto";

/** Regras do portal que valem para o cliente (sem o liga/desliga). */
export interface PortalRules {
  minAdvanceMinutes: number;
  maxDaysAhead: number;
  cancelUntilHours: number;
}

export type PortalSettingsView = PortalRules & { enabled: boolean };

// Padrão de uma clínica que ainda não mexeu nas regras: portal desligado.
export const PORTAL_DEFAULTS: PortalSettingsView = {
  enabled: false,
  minAdvanceMinutes: 60,
  maxDaysAhead: 30,
  cancelUntilHours: 24,
};

/** Regras do portal da própria clínica (ADMIN, funcionalidade `client-portal`). */
@Injectable()
export class PortalSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async find(companyId: string): Promise<PortalSettingsView> {
    const settings = await this.prisma.portalSettings.findUnique({
      where: { companyId },
    });
    return settings ? this.toView(settings) : { ...PORTAL_DEFAULTS };
  }

  // Substitui as regras de uma vez (o registro nasce na primeira gravação).
  async replace(
    companyId: string,
    dto: UpdatePortalSettingsDto,
  ): Promise<PortalSettingsView> {
    const settings = await this.prisma.portalSettings.upsert({
      where: { companyId },
      create: { companyId, ...dto },
      update: { ...dto, updatedAt: new Date() },
    });
    return this.toView(settings);
  }

  private toView(settings: PortalSettingsView): PortalSettingsView {
    return {
      enabled: settings.enabled,
      minAdvanceMinutes: settings.minAdvanceMinutes,
      maxDaysAhead: settings.maxDaysAhead,
      cancelUntilHours: settings.cancelUntilHours,
    };
  }
}
