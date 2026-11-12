import { Injectable } from "@nestjs/common";
import { AppointmentStatus } from "../../../generated/prisma/enums";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { buildHome, homeRanges, type HomeRow } from "./professional-home";
import { ProfessionalLinkService } from "./professional-link.service";

// Teto de segurança: um profissional não chega perto disso em dois meses.
const ROW_LIMIT = 5000;
// Os próximos agendamentos olham algumas dezenas: um agrupamento de turma ocupa
// várias linhas, então a folga é grande para sobrar 3 atendimentos.
const UPCOMING_ROWS = 60;

const select = {
  id: true,
  startAt: true,
  endAt: true,
  status: true,
  classSessionId: true,
  clientId: true,
  client: { select: { name: true } },
  service: { select: { name: true } },
} as const;

const toRow = (row: {
  id: string;
  startAt: Date;
  endAt: Date;
  status: AppointmentStatus;
  classSessionId: string | null;
  clientId: string;
  client: { name: string };
  service: { name: string };
}): HomeRow => ({
  id: row.id,
  startAt: row.startAt,
  endAt: row.endAt,
  status: row.status,
  classSessionId: row.classSessionId,
  clientId: row.clientId,
  clientName: row.client.name,
  serviceName: row.service.name,
});

/**
 * Início do app do profissional: hoje, a semana, o mês e os próximos, só dele
 * (o profissional vem do vínculo do usuário). Sem pagamento nem dado pessoal.
 */
@Injectable()
export class ProfessionalHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
    private readonly link: ProfessionalLinkService,
  ) {}

  async find(user: AuthenticatedUser, now = new Date()) {
    const professionalId = await this.link.requireProfessionalId(user);
    const timeZone = await this.companyService.getTimeZone(user.companyId);
    const range = homeRanges(now, timeZone);
    const base = { companyId: user.companyId, professionalId };

    const [rows, upcoming] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { ...base, startAt: { gte: range.from, lt: range.to } },
        orderBy: { startAt: "asc" },
        take: ROW_LIMIT,
        select,
      }),
      this.prisma.appointment.findMany({
        where: {
          ...base,
          startAt: { gte: range.tomorrowStart },
          status: {
            in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
          },
        },
        orderBy: { startAt: "asc" },
        take: UPCOMING_ROWS,
        select,
      }),
    ]);

    return buildHome(rows.map(toRow), upcoming.map(toRow), now, timeZone);
  }
}
