import { Injectable } from "@nestjs/common";
import { PeopleType } from "../../../generated/prisma/enums";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { localDateOf } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { addDays } from "../subscription/subscription-status";
import {
  buildPlatformDashboard,
  lastTwelveMonths,
  type CompanyUsage,
  type PlatformDashboard,
} from "./platform-dashboard";

/** Fuso das contas da plataforma (meses dos gráficos, listas de atenção). */
const PLATFORM_TIME_ZONE = "America/Sao_Paulo";

/**
 * Junta do banco o que o painel do SUPER_ADMIN precisa (empresas ativas, menos
 * a da plataforma) e entrega às contas puras de `buildPlatformDashboard`.
 */
@Injectable()
export class PlatformDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async build(
    currentUser: AuthenticatedUser,
    now = new Date(),
  ): Promise<PlatformDashboard> {
    const platformId = currentUser.companyId;
    const today = localDateOf(now, PLATFORM_TIME_ZONE);
    const months = lastTwelveMonths(today);
    const since30 = addDays(now, -30);
    // Primeiro dia do mês mais antigo do gráfico, no fuso da plataforma (margem
    // de um dia; o agrupamento por mês descarta o que sobrar).
    const since12 = addDays(new Date(`${months[0]}-01T00:00:00Z`), -1);

    const [companies, recent, last, people, monthly, payments] =
      await Promise.all([
        // Inativas ficam de fora: estão bloqueadas e não pagam.
        this.prisma.company.findMany({
          where: { id: { not: platformId }, isActive: true },
          select: {
            id: true,
            corporateReason: true,
            fantasyName: true,
            createdAt: true,
            timezone: true,
            subscription: true,
          },
        }),
        this.prisma.appointment.groupBy({
          by: ["companyId"],
          where: {
            createdAt: { gte: since30 },
            companyId: { not: platformId },
          },
          _count: { _all: true },
        }),
        this.prisma.appointment.groupBy({
          by: ["companyId"],
          where: { companyId: { not: platformId } },
          _max: { createdAt: true },
        }),
        this.prisma.people.groupBy({
          by: ["companyId", "type"],
          where: {
            deletedAt: null,
            type: { in: [PeopleType.CLIENT, PeopleType.PROFESSIONAL] },
            companyId: { not: platformId },
          },
          _count: { _all: true },
        }),
        // Agendamentos criados por mês, no fuso da plataforma ("createdAt" é UTC).
        this.prisma.$queryRaw<{ month: string; count: number }[]>`
        SELECT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${PLATFORM_TIME_ZONE}, 'YYYY-MM') AS month,
               count(*)::int AS count
        FROM appointments
        WHERE "createdAt" >= ${since12} AND "companyId" <> ${platformId}
        GROUP BY 1`,
        // Pagamentos das assinaturas (paidAt já é a data de calendário).
        this.prisma.subscriptionPayment.findMany({
          where: { paidAt: { gte: new Date(`${months[0]}-01T00:00:00Z`) } },
          select: { paidAt: true, amount: true },
        }),
      ]);

    const received = new Map<string, number>();
    for (const payment of payments) {
      const month = payment.paidAt.toISOString().slice(0, 7);
      received.set(
        month,
        (received.get(month) ?? 0) + payment.amount.toNumber(),
      );
    }

    const usage = new Map<string, CompanyUsage>();
    const usageOf = (companyId: string) => {
      const current = usage.get(companyId) ?? {
        appointments30d: 0,
        lastActivityAt: null,
        clients: 0,
        professionals: 0,
      };
      usage.set(companyId, current);
      return current;
    };
    for (const row of recent) {
      usageOf(row.companyId).appointments30d = row._count._all;
    }
    for (const row of last) {
      usageOf(row.companyId).lastActivityAt = row._max.createdAt;
    }
    for (const row of people) {
      const current = usageOf(row.companyId);
      if (row.type === PeopleType.CLIENT) current.clients = row._count._all;
      else current.professionals = row._count._all;
    }

    return buildPlatformDashboard({
      companies: companies.map((company) => ({
        id: company.id,
        name: company.fantasyName ?? company.corporateReason,
        createdMonth: localDateOf(company.createdAt, PLATFORM_TIME_ZONE)
          .toISOString()
          .slice(0, 7),
        today: localDateOf(now, company.timezone),
        subscription: company.subscription && {
          ...company.subscription,
          price: company.subscription.price.toNumber(),
        },
      })),
      usage,
      appointmentsByMonth: new Map(
        monthly.map((row) => [row.month, row.count]),
      ),
      receivedByMonth: received,
      months,
      now,
    });
  }
}
