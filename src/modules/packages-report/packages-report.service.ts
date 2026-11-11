import { Injectable } from "@nestjs/common";
import { AppointmentStatus } from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import type { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { periodOf, type Period } from "../../common/time/report-period";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { localDateOf } from "../../common/time/time-zone";
import type {
  PackagesEndingQueryDto,
  PackagesReportQueryDto,
} from "./dto/packages-report-query.dto";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Janela do "terminando em breve", em dias a partir de hoje. */
export const ENDING_WINDOW_DAYS = 30;

/** O que o relatório lê de cada contratação. */
export interface ReportContract {
  id: string;
  clientId: string;
  plan: { id: string; name: string };
  totalAmount: Decimal;
  /** Datas de calendário (meia-noite UTC), como no banco. */
  endDate: Date;
  createdAt: Date;
  cancelledAt: Date | null;
}

export interface PackagesByPlan {
  id: string;
  name: string;
  /** Contratações novas no período e o valor contratado delas. */
  created: number;
  amount: string;
  /** Ativas hoje. */
  active: number;
  /** Canceladas no período. */
  cancelled: number;
}

export interface PackagesReport {
  created: { count: number; amount: string };
  active: number;
  cancelled: number;
  ending: number;
  byPlan: PackagesByPlan[];
}

export interface EndingContract {
  id: string;
  client: {
    id: string;
    name: string;
    photoUrl: string | null;
    phone: string | null;
  };
  plan: { id: string; name: string };
  /** AAAA-MM-DD. */
  endDate: string;
  /** Sessões concluídas e o total (sem as canceladas). */
  sessions: { completed: number; total: number };
}

const inPeriod = (date: Date | null, period: Period) =>
  date !== null && date >= period.start && date < period.end;

/** Ativa hoje: não cancelada e com fim de hoje em diante (as futuras entram). */
export const isActive = (contract: ReportContract, today: Date) =>
  contract.cancelledAt === null && contract.endDate >= today;

/**
 * Ativas que terminam até hoje + 30 dias e que o cliente ainda não renovou
 * (nenhuma outra ativa dele termina depois). Do fim mais próximo ao mais
 * distante.
 */
export function endingContracts<T extends ReportContract>(
  contracts: T[],
  today: Date,
): T[] {
  const active = contracts.filter((contract) => isActive(contract, today));
  const limit = new Date(today.getTime() + ENDING_WINDOW_DAYS * DAY_MS);
  return active
    .filter(
      (contract) =>
        contract.endDate <= limit &&
        !active.some(
          (other) =>
            other.id !== contract.id &&
            other.clientId === contract.clientId &&
            other.endDate > contract.endDate,
        ),
    )
    .sort((a, b) => a.endDate.getTime() - b.endDate.getTime());
}

/**
 * Os números do relatório (função pura): novas e canceladas no período, ativas
 * e terminando hoje, e o mesmo por pacote.
 */
export function summarizePackages(
  contracts: ReportContract[],
  period: Period,
  today: Date,
): PackagesReport {
  const plans = new Map<
    string,
    Omit<PackagesByPlan, "amount"> & { amount: Decimal }
  >();
  let createdCount = 0;
  let createdAmount = new Decimal(0);
  let active = 0;
  let cancelled = 0;

  for (const contract of contracts) {
    const plan = plans.get(contract.plan.id) ?? {
      ...contract.plan,
      created: 0,
      amount: new Decimal(0),
      active: 0,
      cancelled: 0,
    };
    plans.set(contract.plan.id, plan);

    if (inPeriod(contract.createdAt, period)) {
      createdCount += 1;
      createdAmount = createdAmount.plus(contract.totalAmount);
      plan.created += 1;
      plan.amount = plan.amount.plus(contract.totalAmount);
    }
    if (isActive(contract, today)) {
      active += 1;
      plan.active += 1;
    }
    if (inPeriod(contract.cancelledAt, period)) {
      cancelled += 1;
      plan.cancelled += 1;
    }
  }

  return {
    created: { count: createdCount, amount: createdAmount.toFixed(2) },
    active,
    cancelled,
    ending: endingContracts(contracts, today).length,
    // Só os pacotes com algum número; maior valor contratado primeiro.
    byPlan: [...plans.values()]
      .filter((plan) => plan.created + plan.active + plan.cancelled > 0)
      .sort(
        (a, b) =>
          b.amount.comparedTo(a.amount) ||
          b.created - a.created ||
          b.active - a.active ||
          a.name.localeCompare(b.name),
      )
      .map((plan) => ({ ...plan, amount: plan.amount.toFixed(2) })),
  };
}

const contractSelect = {
  id: true,
  clientId: true,
  plan: { select: { id: true, name: true } },
  totalAmount: true,
  endDate: true,
  createdAt: true,
  cancelledAt: true,
} as const;

/**
 * Relatório de pacotes: a vida das contratações (ver docs/business-rules/relatorios.md,
 * "Relatório de pacotes"). Só leitura.
 */
@Injectable()
export class PackagesReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
  ) {}

  async report(
    { from, to }: PackagesReportQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<PackagesReport> {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const period = periodOf(from, to, timeZone, now);
    const today = localDateOf(now, timeZone);
    const between = { gte: period.start, lt: period.end };

    // Só o que entra em alguma conta: nova ou cancelada no período, ou ativa.
    const contracts = await this.prisma.clientPlan.findMany({
      where: {
        companyId,
        OR: [
          { createdAt: between },
          { cancelledAt: between },
          { cancelledAt: null, endDate: { gte: today } },
        ],
      },
      select: contractSelect,
    });
    return summarizePackages(contracts, period, today);
  }

  /** Terminando nos próximos 30 dias, sem renovação, com as sessões. */
  async ending(
    { page, limit }: PackagesEndingQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<PaginatedResult<EndingContract>> {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const today = localDateOf(now, timeZone);

    const active = await this.prisma.clientPlan.findMany({
      where: { companyId, cancelledAt: null, endDate: { gte: today } },
      select: {
        ...contractSelect,
        client: {
          select: {
            id: true,
            name: true,
            photoUrl: true,
            contacts: {
              where: { isPrincipal: true, deletedAt: null },
              select: { phone: true },
              take: 1,
            },
          },
        },
      },
    });
    const ending = endingContracts(active, today).sort(
      (a, b) =>
        a.endDate.getTime() - b.endDate.getTime() ||
        a.client.name.localeCompare(b.client.name),
    );
    const pageItems = ending.slice((page - 1) * limit, page * limit);

    // Sessões da página: os agendamentos das recorrências de cada contratação.
    const appointments = pageItems.length
      ? await this.prisma.appointment.findMany({
          where: {
            companyId,
            status: { not: AppointmentStatus.CANCELLED },
            recurringAppointment: {
              clientPlanId: { in: pageItems.map((item) => item.id) },
            },
          },
          select: {
            status: true,
            recurringAppointment: { select: { clientPlanId: true } },
          },
        })
      : [];

    return {
      items: pageItems.map((contract) => {
        const sessions = appointments.filter(
          (row) => row.recurringAppointment?.clientPlanId === contract.id,
        );
        return {
          id: contract.id,
          client: {
            id: contract.client.id,
            name: contract.client.name,
            photoUrl: contract.client.photoUrl,
            phone: contract.client.contacts[0]?.phone ?? null,
          },
          plan: contract.plan,
          endDate: contract.endDate.toISOString().slice(0, 10),
          sessions: {
            completed: sessions.filter(
              (row) => row.status === AppointmentStatus.COMPLETED,
            ).length,
            total: sessions.length,
          },
        };
      }),
      total: ending.length,
      page,
      limit,
    };
  }
}
