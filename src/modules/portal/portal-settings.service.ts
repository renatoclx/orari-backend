import { BadRequestException, Injectable } from "@nestjs/common";
import type { BusinessSegment } from "../../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import { UpdatePortalSettingsDto } from "./dto/update-portal-settings.dto";

/** Regras do portal que valem para o cliente (sem o liga/desliga). */
export interface PortalRules {
  minAdvanceMinutes: number;
  maxDaysAhead: number;
  cancelUntilHours: number;
}

export type PortalSettingsView = PortalRules & {
  enabled: boolean;
  // Busca de estabelecimentos do app.
  listed: boolean;
  segment: BusinessSegment | null;
};

// Padrão de uma clínica que ainda não mexeu nas regras: portal desligado.
export const PORTAL_DEFAULTS: PortalSettingsView = {
  enabled: false,
  minAdvanceMinutes: 60,
  maxDaysAhead: 30,
  cancelUntilHours: 24,
  listed: false,
  segment: null,
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

  /**
   * Substitui as regras de uma vez (o registro nasce na primeira gravação).
   * `listed` e `segment` ausentes ficam como estão. Aparecer na busca exige
   * o segmento.
   */
  async replace(
    companyId: string,
    dto: UpdatePortalSettingsDto,
  ): Promise<PortalSettingsView> {
    const current = await this.find(companyId);
    const listed = dto.listed ?? current.listed;
    const segment = dto.segment ?? current.segment;
    if (listed && !segment) {
      throw new BadRequestException(
        "Escolha o segmento do estabelecimento para aparecer na busca",
      );
    }

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
      listed: settings.listed,
      segment: settings.segment,
    };
  }
}
