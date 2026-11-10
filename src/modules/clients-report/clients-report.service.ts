import { Injectable } from "@nestjs/common";
import {
  AppointmentSource,
  AppointmentStatus,
  PeopleType,
} from "../../../generated/prisma/enums";
import type { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import {
  dayString,
  periodOf,
  type Period,
} from "../../common/time/report-period";
import { toZonedParts } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { LAPSED_AFTER_DAYS } from "../client-portfolio/client-portfolio.service";
import { CompanyService } from "../company/company.service";
import type {
  ClientsBirthdaysQueryDto,
  ClientsReportQueryDto,
} from "./dto/clients-report-query.dto";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Quantas cidades aparecem pelo nome; as demais somam em "Outras". */
export const TOP_CITIES = 5;

/** Faixas de idade (anos completos, hoje); `max` incluído. */
export const AGE_RANGES = [
  { key: "0-17", min: 0, max: 17 },
  { key: "18-29", min: 18, max: 29 },
  { key: "30-44", min: 30, max: 44 },
  { key: "45-59", min: 45, max: 59 },
  { key: "60+", min: 60, max: Infinity },
] as const;

/** Tipos de atendimento (não exclusivos: pacote numa turma conta nos dois). */
export type AttendanceKind = "single" | "recurrence" | "package" | "class";

/** Cliente ativo no cadastro, com o que o relatório lê dele. */
export interface ReportClient {
  id: string;
  birthDate: Date | null;
  hasApp: boolean;
  /** "Cidade/UF" do endereço principal; null sem endereço. */
  city: string | null;
  /** Primeiro e último atendimento concluído (qualquer data). */
  firstCompleted: Date | null;
  lastCompleted: Date | null;
  /** Tem agendamento futuro agendado ou confirmado. */
  hasUpcoming: boolean;
}

/** Atendimento concluído no período. */
export interface PeriodAttendance {
  clientId: string;
  source: AppointmentSource;
  kinds: AttendanceKind[];
}

/** Quantidade e parte da base (de 0 a 1; 0 quando a base é vazia). */
export interface Share {
  count: number;
  share: number;
}

export interface ClientsReport {
  /** Clientes ativos no cadastro (não inativados). */
  clients: number;
  /** Concluído nos últimos 60 dias ou com agendamento futuro. */
  active: number;
  /** Primeiro atendimento concluído na empresa dentro do período. */
  newClients: number;
  /** Sem concluído nos últimos 60 dias e sem nada marcado. */
  lapsed: number;
  /** Clientes com atendimento concluído no período. */
  attended: number;
  /** Concluídos no período ÷ clientes atendidos; null sem atendimento. */
  frequency: number | null;
  /** Por tipo, sobre os clientes atendidos (um cliente pode estar em vários). */
  kinds: Record<AttendanceKind, Share>;
  /** Concluídos no período por onde foram agendados. */
  sources: { clinic: Share; portal: Share };
  /** Clientes com o app ligado, sobre os do cadastro. */
  withApp: Share;
  /** Sobre os do cadastro; `key` null: sem data de nascimento. */
  ages: (Share & { key: string | null })[];
  /** As mais comuns; `name` "Outras" agrupa o resto e null é sem endereço. */
  cities: (Share & { name: string | null; others?: true })[];
}

export interface BirthdayClient {
  id: string;
  name: string;
  photoUrl: string | null;
  phone: string | null;
  /** Data de nascimento (AAAA-MM-DD). */
  birthDate: string;
  /** O aniversário dentro do período (AAAA-MM-DD). */
  birthday: string;
  /** Idade que completa no aniversário. */
  turning: number;
}

const shareOf = (count: number, base: number): Share => ({
  count,
  share: base > 0 ? count / base : 0,
});

const monthDay = (date: string) => date.slice(5);
const isLeap = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Idade em anos completos numa data de calendário (AAAA-MM-DD). */
export function ageOn(birthDate: Date, on: string): number {
  const birth = birthDate.toISOString().slice(0, 10);
  const years = Number(on.slice(0, 4)) - Number(birth.slice(0, 4));
  return monthDay(on) < monthDay(birth) ? years - 1 : years;
}

/** Os dias do período, AAAA-MM-DD no fuso da empresa (no máximo 366). */
export function periodDays(period: Period, timeZone: string): string[] {
  const first = toZonedParts(period.start, timeZone);
  const last = dayString(
    toZonedParts(new Date(period.end.getTime() - 1), timeZone),
  );
  const days: string[] = [];
  // 366 dias cobrem qualquer aniversário (o 29/02 cai para 28/02 abaixo).
  for (let i = 0; i < 366; i += 1) {
    const date = new Date(Date.UTC(first.year, first.month - 1, first.day + i));
    const day = date.toISOString().slice(0, 10);
    if (day > last) break;
    days.push(day);
  }
  return days;
}

/**
 * O aniversário de quem nasceu em `birthDate` dentro dos dias do período, ou
 * null. Quem nasceu em 29/02 comemora em 28/02 nos anos que não são
 * bissextos.
 */
export function birthdayIn(birthDate: Date, days: string[]): string | null {
  const birth = monthDay(birthDate.toISOString().slice(0, 10));
  for (const day of days) {
    if (monthDay(day) === birth) return day;
    if (
      birth === "02-29" &&
      monthDay(day) === "02-28" &&
      !isLeap(Number(day.slice(0, 4)))
    ) {
      return day;
    }
  }
  return null;
}

/**
 * Os números do perfil (função pura). `today` é o dia da empresa
 * (AAAA-MM-DD); `now`, o instante, para os 60 dias.
 */
export function summarizeClients(
  clients: ReportClient[],
  attendances: PeriodAttendance[],
  period: Period,
  today: string,
  now: Date,
): ClientsReport {
  const recent = new Date(now.getTime() - LAPSED_AFTER_DAYS * DAY_MS);
  const total = clients.length;

  const active = clients.filter(
    (client) =>
      client.hasUpcoming ||
      (client.lastCompleted !== null && client.lastCompleted >= recent),
  ).length;
  const newClients = clients.filter(
    (client) =>
      client.firstCompleted !== null &&
      client.firstCompleted >= period.start &&
      client.firstCompleted < period.end,
  ).length;

  // Só os clientes do cadastro ativo; inativados ficam fora do perfil.
  const known = new Set(clients.map((client) => client.id));
  const inPeriod = attendances.filter((row) => known.has(row.clientId));
  const attended = new Set(inPeriod.map((row) => row.clientId));
  const byKind: Record<AttendanceKind, Set<string>> = {
    single: new Set(),
    recurrence: new Set(),
    package: new Set(),
    class: new Set(),
  };
  for (const row of inPeriod) {
    for (const kind of row.kinds) byKind[kind].add(row.clientId);
  }
  const portal = inPeriod.filter(
    (row) => row.source === AppointmentSource.PORTAL,
  ).length;

  const ageCounts = new Map<string | null, number>();
  for (const client of clients) {
    const age = client.birthDate ? ageOn(client.birthDate, today) : null;
    const key =
      age === null
        ? null
        : (AGE_RANGES.find((range) => age >= range.min && age <= range.max)
            ?.key ?? null);
    ageCounts.set(key, (ageCounts.get(key) ?? 0) + 1);
  }

  const cityCounts = new Map<string, number>();
  let withoutCity = 0;
  for (const client of clients) {
    if (client.city === null) withoutCity += 1;
    else cityCounts.set(client.city, (cityCounts.get(client.city) ?? 0) + 1);
  }
  const ranked = [...cityCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const others = ranked
    .slice(TOP_CITIES)
    .reduce((sum, [, count]) => sum + count, 0);

  return {
    clients: total,
    active,
    newClients,
    lapsed: total - active,
    attended: attended.size,
    frequency: attended.size > 0 ? inPeriod.length / attended.size : null,
    kinds: {
      single: shareOf(byKind.single.size, attended.size),
      recurrence: shareOf(byKind.recurrence.size, attended.size),
      package: shareOf(byKind.package.size, attended.size),
      class: shareOf(byKind.class.size, attended.size),
    },
    sources: {
      clinic: shareOf(inPeriod.length - portal, inPeriod.length),
      portal: shareOf(portal, inPeriod.length),
    },
    withApp: shareOf(clients.filter((client) => client.hasApp).length, total),
    ages: [
      ...AGE_RANGES.map(({ key }) => ({
        key,
        ...shareOf(ageCounts.get(key) ?? 0, total),
      })),
      { key: null, ...shareOf(ageCounts.get(null) ?? 0, total) },
    ],
    cities: [
      ...ranked
        .slice(0, TOP_CITIES)
        .map(([name, count]) => ({ name, ...shareOf(count, total) })),
      ...(others > 0
        ? [{ name: "Outras", others: true as const, ...shareOf(others, total) }]
        : []),
      ...(withoutCity > 0
        ? [{ name: null, ...shareOf(withoutCity, total) }]
        : []),
    ],
  };
}

/** Tipos de um atendimento concluído pela origem dele. */
export function kindsOf(row: {
  classSessionId: string | null;
  recurringAppointmentId: string | null;
  recurringAppointment: { clientPlanId: string | null } | null;
}): AttendanceKind[] {
  const kinds: AttendanceKind[] = [];
  if (row.recurringAppointment?.clientPlanId) kinds.push("package");
  else if (row.recurringAppointmentId) kinds.push("recurrence");
  if (row.classSessionId) kinds.push("class");
  return kinds.length > 0 ? kinds : ["single"];
}

const clientWhere = (companyId: string) => ({
  companyId,
  type: PeopleType.CLIENT,
  deletedAt: null,
});

/**
 * Perfil do cliente da empresa toda (ver docs/business-rules.md, "Perfil do
 * cliente"). Só leitura.
 */
@Injectable()
export class ClientsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
  ) {}

  async report(
    { from, to }: ClientsReportQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<ClientsReport> {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const period = periodOf(from, to, timeZone, now);
    const today = dayString(toZonedParts(now, timeZone));

    const [people, completed, upcoming, attendances] = await Promise.all([
      this.prisma.people.findMany({
        where: clientWhere(companyId),
        select: {
          id: true,
          birthDate: true,
          clientAccountId: true,
          addresses: {
            where: { isPrincipal: true, deletedAt: null },
            select: {
              city: {
                select: { name: true, state: { select: { acronym: true } } },
              },
            },
            take: 1,
          },
        },
      }),
      this.prisma.appointment.groupBy({
        by: ["clientId"],
        where: { companyId, status: AppointmentStatus.COMPLETED },
        _min: { startAt: true },
        _max: { startAt: true },
      }),
      this.prisma.appointment.findMany({
        where: {
          companyId,
          status: {
            in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
          },
          startAt: { gte: now },
        },
        distinct: ["clientId"],
        select: { clientId: true },
      }),
      this.prisma.appointment.findMany({
        where: {
          companyId,
          status: AppointmentStatus.COMPLETED,
          startAt: { gte: period.start, lt: period.end },
        },
        select: {
          clientId: true,
          source: true,
          classSessionId: true,
          recurringAppointmentId: true,
          recurringAppointment: { select: { clientPlanId: true } },
        },
      }),
    ]);

    const completedBy = new Map(completed.map((row) => [row.clientId, row]));
    const upcomingIds = new Set(upcoming.map((row) => row.clientId));

    return summarizeClients(
      people.map((person) => {
        const city = person.addresses[0]?.city;
        return {
          id: person.id,
          birthDate: person.birthDate,
          hasApp: person.clientAccountId !== null,
          city: city ? `${city.name}/${city.state.acronym}` : null,
          firstCompleted: completedBy.get(person.id)?._min.startAt ?? null,
          lastCompleted: completedBy.get(person.id)?._max.startAt ?? null,
          hasUpcoming: upcomingIds.has(person.id),
        };
      }),
      attendances.map((row) => ({
        clientId: row.clientId,
        source: row.source,
        kinds: kindsOf(row),
      })),
      period,
      today,
      now,
    );
  }

  /** Aniversariantes do período, pela data do aniversário (empate: nome). */
  async birthdays(
    { from, to, page, limit }: ClientsBirthdaysQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<PaginatedResult<BirthdayClient>> {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const days = periodDays(periodOf(from, to, timeZone, now), timeZone);

    const people = await this.prisma.people.findMany({
      where: { ...clientWhere(companyId), birthDate: { not: null } },
      select: {
        id: true,
        name: true,
        photoUrl: true,
        birthDate: true,
        contacts: {
          where: { isPrincipal: true, deletedAt: null },
          select: { phone: true },
          take: 1,
        },
      },
    });

    const items = people
      .flatMap((person) => {
        const birthday = birthdayIn(person.birthDate!, days);
        if (!birthday) return [];
        return [
          {
            id: person.id,
            name: person.name,
            photoUrl: person.photoUrl,
            phone: person.contacts[0]?.phone ?? null,
            birthDate: person.birthDate!.toISOString().slice(0, 10),
            birthday,
            turning:
              Number(birthday.slice(0, 4)) - person.birthDate!.getUTCFullYear(),
          },
        ];
      })
      .sort(
        (a, b) =>
          a.birthday.localeCompare(b.birthday) || a.name.localeCompare(b.name),
      );

    return {
      items: items.slice((page - 1) * limit, page * limit),
      total: items.length,
      page,
      limit,
    };
  }
}
