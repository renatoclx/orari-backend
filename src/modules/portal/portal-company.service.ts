import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { BusinessSegment } from "../../../generated/prisma/enums";
import { CompanyAccessService } from "../company-access/company-access.service";
import { PORTAL_DEFAULTS, type PortalRules } from "./portal-settings.service";

export interface PortalCompany {
  id: string;
  name: string;
  logoUrl: string | null;
  segment: BusinessSegment | null;
  timezone: string;
  rules: PortalRules;
}

/**
 * Resolve a clínica pelo endereço do portal (o subdomínio). O portal só existe
 * para quem a clínica ligou e o plano permite; nos demais casos, a resposta é a
 * mesma de uma clínica inexistente (404), sem revelar o motivo.
 */
@Injectable()
export class PortalCompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyAccessService: CompanyAccessService,
  ) {}

  async findBySlug(slug: string): Promise<PortalCompany> {
    const company = await this.prisma.company.findUnique({
      where: { subdomain: slug },
      select: {
        id: true,
        fantasyName: true,
        corporateReason: true,
        logoUrl: true,
        timezone: true,
        isActive: true,
        portalSettings: true,
      },
    });
    const enabled = company?.isActive && company.portalSettings?.enabled;
    if (
      !company ||
      !enabled ||
      !(await this.companyAccessService.can(
        company.id,
        "client-portal",
        "view",
      ))
    ) {
      throw new NotFoundException("Portal não encontrado");
    }

    const settings = company.portalSettings ?? PORTAL_DEFAULTS;
    return {
      id: company.id,
      name: company.fantasyName ?? company.corporateReason,
      logoUrl: company.logoUrl,
      segment: settings.segment,
      timezone: company.timezone,
      rules: {
        minAdvanceMinutes: settings.minAdvanceMinutes,
        maxDaysAhead: settings.maxDaysAhead,
        cancelUntilHours: settings.cancelUntilHours,
      },
    };
  }
}
