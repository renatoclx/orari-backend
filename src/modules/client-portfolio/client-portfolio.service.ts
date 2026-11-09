import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AppointmentStatus,
  PaymentStatus,
  PeopleType,
} from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import type { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { toZonedParts, zonedToUtc } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import type {
  ClientPortfolioClientsQueryDto,
  PortfolioStatus,
} from "./dto/client-portfolio-clients-query.dto";
import type { ClientPortfolioQueryDto } from "./dto/client-portfolio-query.dto";

// Sem atendimento concluído há mais que isso (e nada agendado): "Sem retorno".
export const LAPSED_AFTER_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

// Agendamento futuro que mantém o cliente ativo (em andamento já começou).
const UPCOMING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
];

type Day = { year: number; month: number; day: number };

const parseDay = (value: string): Day => {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
};

const nextDay = ({ year, month, day }: Day): Day => {
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

const dayKey = ({ year, month, day }: Day) => year * 10000 + month * 100 + day;

/** Período em instantes: início incluído, fim excluído. */
export interface Period {
  start: Date;
  end: Date;
}

/**
 * Situação do cliente na carteira de um profissional. Novo vale para o
 * período; Ativo e Sem retorno, para hoje. Um novo também é ativo: o selo
 * mostra Novo, que vem primeiro.
 */
export function classifyPortfolioClient(
  dates: {
    firstCompletedAt: Date | null;
    lastCompletedAt: Date | null;
    nextAt: Date | null;
  },
  period: Period,
  now: Date,
): PortfolioStatus {
  const { firstCompletedAt, lastCompletedAt, nextAt } = dates;
  if (
    firstCompletedAt &&
    firstCompletedAt >= period.start &&
    firstCompletedAt < period.end
  ) {
    return "NEW";
  }
  const recent =
    lastCompletedAt !== null &&
    now.getTime() - lastCompletedAt.getTime() <= LAPSED_AFTER_DAYS * DAY_MS;
  return recent || nextAt ? "ACTIVE" : "LAPSED";
}

export interface PortfolioClient {
  id: string;
  name: string;
  photoUrl: string | null;
  phone: string | null;
  status: PortfolioStatus;
  lastCompleted: { startAt: Date; serviceName: string } | null;
  nextAt: Date | null;
  completedInPeriod: number;
  // Em aberto do cliente com o profissional (todos os vencimentos), duas casas.
  pending: string;
}

export interface PortfolioSummary {
  clients: number;
  newClients: number;
  lapsedClients: number;
  completed: number;
  packageSessions: number;
  received: string;
  pending: string;
  // Faturado ÷ atendimentos concluídos com pagamento próprio; null sem nenhum.
  averageTicket: string | null;
}

/**
 * Carteira de clientes por profissional (ver docs/business-rules.md, "Carteira
 * de clientes"). Só leitura: tudo sai dos agendamentos e pagamentos.
 */
@Injectable()
export class ClientPortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
  ) {}

  /** Os números dos cartões do período. */
  async summary(
    query: ClientPortfolioQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<PortfolioSummary> {
    const { period, clients } = await this.load(query, companyId, now);
    const { professionalId } = query;
    const completedInPeriod = {
      companyId,
      professionalId,
      status: AppointmentStatus.COMPLETED,
      startAt: { gte: period.start, lt: period.end },
      client: { deletedAt: null },
    };

    const [completed, packageSessions, payments] = await Promise.all([
      this.prisma.appointment.count({ where: completedInPeriod }),
      this.prisma.appointment.count({
        where: {
          ...completedInPeriod,
          recurringAppointment: { clientPlanId: { not: null } },
        },
      }),
      // Pagamentos próprios dos concluídos (sessão de pacote não tem).
      this.prisma.payment.findMany({
        where: {
          deletedAt: null,
          status: { in: [PaymentStatus.PAID, PaymentStatus.PENDING] },
          appointment: completedInPeriod,
        },
        select: { amount: true, status: true },
      }),
    ]);

    let received = new Decimal(0);
    let pending = new Decimal(0);
    for (const payment of payments) {
      if (payment.status === PaymentStatus.PAID)
        received = received.plus(payment.amount);
      else pending = pending.plus(payment.amount);
    }

    return {
      clients: clients.length,
      newClients: clients.filter((c) => c.status === "NEW").length,
      lapsedClients: clients.filter((c) => c.status === "LAPSED").length,
      completed,
      packageSessions,
      received: received.toFixed(2),
      pending: pending.toFixed(2),
      averageTicket:
        payments.length > 0
          ? received.plus(pending).div(payments.length).toFixed(2)
          : null,
    };
  }

  /**
   * Os clientes da carteira, paginados. Ordem: quem precisa de contato
   * primeiro (sem atendimento nem agendamento, depois o último atendimento
   * mais antigo); quem só tem agendamento futuro vai para o fim.
   */
  async clients(
    query: ClientPortfolioClientsQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<PaginatedResult<PortfolioClient>> {
    const { clients } = await this.load(query, companyId, now);
    const search = query.search?.trim()
      ? normalizeForSearch(query.search)
      : null;

    const filtered = clients
      .filter((client) => !query.status || client.status === query.status)
      // Mesma normalização do cadastro (normalizedName).
      .filter(
        (client) => !search || normalizeForSearch(client.name).includes(search),
      )
      .sort((a, b) => sortKey(a) - sortKey(b) || a.name.localeCompare(b.name));

    const { page, limit } = query;
    return {
      items: filtered.slice((page - 1) * limit, page * limit),
      total: filtered.length,
      page,
      limit,
    };
  }

  // Monta a carteira inteira (poucas centenas de clientes por profissional).
  private async load(
    { professionalId, from, to }: ClientPortfolioQueryDto,
    companyId: string,
    now: Date,
  ) {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const period = periodOf(from, to, timeZone, now);

    const professional = await this.prisma.people.findFirst({
      where: { id: professionalId, companyId, type: PeopleType.PROFESSIONAL },
      select: { id: true },
    });
    if (!professional) {
      throw new NotFoundException("Profissional não encontrado");
    }

    // Só clientes ativos; cancelados não contam em nada.
    const base = { companyId, professionalId, client: { deletedAt: null } };
    const completed = { ...base, status: AppointmentStatus.COMPLETED };

    const [members, first, last, next, inPeriod, pendingPayments] =
      await Promise.all([
        this.prisma.appointment.groupBy({
          by: ["clientId"],
          where: { ...base, status: { not: AppointmentStatus.CANCELLED } },
        }),
        this.prisma.appointment.groupBy({
          by: ["clientId"],
          where: completed,
          _min: { startAt: true },
        }),
        this.prisma.appointment.findMany({
          where: completed,
          orderBy: [{ clientId: "asc" }, { startAt: "desc" }],
          distinct: ["clientId"],
          select: {
            clientId: true,
            startAt: true,
            service: { select: { name: true } },
          },
        }),
        this.prisma.appointment.findMany({
          where: {
            ...base,
            status: { in: UPCOMING_STATUSES },
            startAt: { gte: now },
          },
          orderBy: [{ clientId: "asc" }, { startAt: "asc" }],
          distinct: ["clientId"],
          select: { clientId: true, startAt: true },
        }),
        this.prisma.appointment.groupBy({
          by: ["clientId"],
          where: {
            ...completed,
            startAt: { gte: period.start, lt: period.end },
          },
          _count: { _all: true },
        }),
        this.prisma.payment.findMany({
          where: {
            deletedAt: null,
            status: PaymentStatus.PENDING,
            appointment: {
              ...base,
              status: { not: AppointmentStatus.CANCELLED },
            },
          },
          select: { amount: true, appointment: { select: { clientId: true } } },
        }),
      ]);

    const ids = members.map((member) => member.clientId);
    const people = await this.prisma.people.findMany({
      where: { id: { in: ids }, companyId, deletedAt: null },
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
    });

    const firstBy = new Map(first.map((r) => [r.clientId, r._min.startAt]));
    const lastBy = new Map(last.map((r) => [r.clientId, r]));
    const nextBy = new Map(next.map((r) => [r.clientId, r.startAt]));
    const countBy = new Map(inPeriod.map((r) => [r.clientId, r._count._all]));
    const pendingBy = new Map<string, Decimal>();
    for (const payment of pendingPayments) {
      const clientId = payment.appointment!.clientId;
      pendingBy.set(
        clientId,
        (pendingBy.get(clientId) ?? new Decimal(0)).plus(payment.amount),
      );
    }

    const clients = people.map((person) => {
      const lastRow = lastBy.get(person.id);
      const nextAt = nextBy.get(person.id) ?? null;
      return {
        id: person.id,
        name: person.name,
        photoUrl: person.photoUrl,
        phone: person.contacts[0]?.phone ?? null,
        status: classifyPortfolioClient(
          {
            firstCompletedAt: firstBy.get(person.id) ?? null,
            lastCompletedAt: lastRow?.startAt ?? null,
            nextAt,
          },
          period,
          now,
        ),
        lastCompleted: lastRow
          ? { startAt: lastRow.startAt, serviceName: lastRow.service.name }
          : null,
        nextAt,
        completedInPeriod: countBy.get(person.id) ?? 0,
        pending: (pendingBy.get(person.id) ?? new Decimal(0)).toFixed(2),
      };
    });

    return { period, clients };
  }
}

// Sem atendimento e sem agendamento: primeiro; só agendamento futuro: por último.
function sortKey(client: PortfolioClient): number {
  if (client.lastCompleted) return client.lastCompleted.startAt.getTime();
  return client.nextAt ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;
}

/** Período do filtro no fuso da empresa; sem datas, o mês atual. */
export function periodOf(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
  now: Date,
): Period {
  const today = toZonedParts(now, timeZone);
  const firstDay = from
    ? parseDay(from)
    : { year: today.year, month: today.month, day: 1 };
  // Último dia do mês: o dia 0 do mês seguinte.
  const lastDay = to
    ? parseDay(to)
    : {
        year: firstDay.year,
        month: firstDay.month,
        day: new Date(Date.UTC(firstDay.year, firstDay.month, 0)).getUTCDate(),
      };
  if (dayKey(lastDay) < dayKey(firstDay)) {
    throw new BadRequestException(
      "A data final precisa ser igual ou depois da inicial",
    );
  }
  return {
    start: zonedToUtc({ ...firstDay, hours: 0, minutes: 0 }, timeZone),
    end: zonedToUtc({ ...nextDay(lastDay), hours: 0, minutes: 0 }, timeZone),
  };
}
