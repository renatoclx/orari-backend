import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

/** Uma clínica que pode receber os avisos dos jobs. */
export interface NotifierCompany {
  id: string;
  name: string;
  timezone: string;
}

/** As clínicas ativas com Mensagens no plano, para os jobs de aviso à equipe. */
@Injectable()
export class NotifierCompanies {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<NotifierCompany[]> {
    const access = await this.prisma.companyFeatureAccess.findMany({
      where: { feature: "messages", canView: true },
      select: { companyId: true },
    });
    const rows = await this.prisma.company.findMany({
      where: { id: { in: access.map((row) => row.companyId) }, isActive: true },
      select: {
        id: true,
        fantasyName: true,
        corporateReason: true,
        timezone: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.fantasyName ?? row.corporateReason,
      timezone: row.timezone,
    }));
  }
}
