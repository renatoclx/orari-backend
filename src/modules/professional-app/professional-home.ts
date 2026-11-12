import { AppointmentStatus } from "../../../generated/prisma/enums";
import {
  toZonedParts,
  weekDayIndexOf,
  zonedToUtc,
  type ZonedParts,
} from "../../common/time/time-zone";

// Regras puras do Início do app do profissional (docs/screens/app-profissional.md):
// agrupam os agendamentos dele em atendimentos e calculam hoje, a semana, o
// mês e os próximos. Sem banco, para testar sem mock.

/** O que a consulta traz de cada agendamento. */
export interface HomeRow {
  id: string;
  startAt: Date;
  endAt: Date;
  status: AppointmentStatus;
  classSessionId: string | null;
  clientId: string;
  clientName: string;
  serviceName: string;
}

// Um atendimento como a Agenda o conta: o avulso, ou a sessão de turma inteira
// (os alunos de uma sessão são vários agendamentos, mas um atendimento só).
interface Unit {
  startAt: Date;
  endAt: Date;
  status: AppointmentStatus;
  isClass: boolean;
  clientName: string;
  serviceName: string;
}

export interface HomeAppointment {
  startAt: Date;
  endAt: Date;
  /** Nulo na turma (vários alunos). */
  clientName: string | null;
  serviceName: string;
  isClass: boolean;
}

export interface ProfessionalHome {
  today: {
    /** Atendimentos de hoje, sem os cancelados. */
    total: number;
    /** Os que ainda não terminaram (agendado, confirmado ou em andamento). */
    remaining: number;
    /** O que está em andamento ou, sem ele, o próximo de hoje. */
    next: (HomeAppointment & { inProgress: boolean }) | null;
  };
  /** Segunda a domingo da semana de hoje, sem os cancelados. */
  week: { date: string; count: number }[];
  month: {
    /** AAAA-MM. */
    month: string;
    completed: number;
    /** Faltas e cancelamentos contam marcações (cada aluno da turma é uma). */
    noShow: number;
    cancelled: number;
    /** Clientes distintos com atendimento concluído. */
    clients: number;
    /** Concluídos do mês anterior, para a comparação. */
    previousCompleted: number;
  };
  /** Os próximos depois de hoje. */
  upcoming: HomeAppointment[];
}

const ACTIVE = new Set<AppointmentStatus>([
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
]);
const NEXT_LIMIT = 3;

const pad = (value: number) => String(value).padStart(2, "0");
export const dayKey = ({
  year,
  month,
  day,
}: Pick<ZonedParts, "year" | "month" | "day">) =>
  `${year}-${pad(month)}-${pad(day)}`;

// O dia do calendário `delta` dias depois (negativo: antes).
function addDays(
  { year, month, day }: Pick<ZonedParts, "year" | "month" | "day">,
  delta: number,
) {
  const date = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

const startOf = (
  day: Pick<ZonedParts, "year" | "month" | "day">,
  timeZone: string,
) => zonedToUtc({ ...day, hours: 0, minutes: 0 }, timeZone);

/** Os limites das consultas do Início, todos no relógio da empresa. */
export function homeRanges(now: Date, timeZone: string) {
  const today = toZonedParts(now, timeZone);
  // Semana de segunda (1) a domingo.
  const sinceMonday = (weekDayIndexOf(today) + 6) % 7;
  const monday = addDays(today, -sinceMonday);
  const monthFirst = { year: today.year, month: today.month, day: 1 };
  const previousFirst =
    today.month === 1
      ? { year: today.year - 1, month: 12, day: 1 }
      : { year: today.year, month: today.month - 1, day: 1 };
  const nextFirst =
    today.month === 12
      ? { year: today.year + 1, month: 1, day: 1 }
      : { year: today.year, month: today.month + 1, day: 1 };

  const weekStart = startOf(monday, timeZone);
  const weekEnd = startOf(addDays(monday, 7), timeZone);
  const previousMonthStart = startOf(previousFirst, timeZone);
  const nextMonthStart = startOf(nextFirst, timeZone);

  return {
    today,
    monday,
    monthFirst,
    previousFirst,
    todayStart: startOf(today, timeZone),
    tomorrowStart: startOf(addDays(today, 1), timeZone),
    monthStart: startOf(monthFirst, timeZone),
    previousMonthStart,
    nextMonthStart,
    // Uma consulta só cobre a semana, o mês e o mês anterior.
    from: weekStart < previousMonthStart ? weekStart : previousMonthStart,
    to: weekEnd > nextMonthStart ? weekEnd : nextMonthStart,
  };
}

// Junta os alunos de cada sessão num atendimento só; o avulso é um atendimento.
function toUnits(rows: HomeRow[]): Unit[] {
  const units: Unit[] = [];
  const sessions = new Map<string, HomeRow[]>();
  for (const row of rows) {
    if (row.classSessionId) {
      sessions.set(row.classSessionId, [
        ...(sessions.get(row.classSessionId) ?? []),
        row,
      ]);
    } else {
      units.push({
        startAt: row.startAt,
        endAt: row.endAt,
        status: row.status,
        isClass: false,
        clientName: row.clientName,
        serviceName: row.serviceName,
      });
    }
  }
  for (const members of sessions.values()) {
    units.push({
      startAt: members[0].startAt,
      endAt: members[0].endAt,
      status: sessionStatus(members),
      isClass: true,
      clientName: "",
      serviceName: members[0].serviceName,
    });
  }
  return units.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

// A sessão vale pelo que aconteceu com os alunos: cancelada só se todos
// cancelaram; concluída ou em andamento se algum chegou lá.
function sessionStatus(members: HomeRow[]): AppointmentStatus {
  const alive = members.filter((m) => m.status !== AppointmentStatus.CANCELLED);
  if (alive.length === 0) return AppointmentStatus.CANCELLED;
  for (const status of [
    AppointmentStatus.COMPLETED,
    AppointmentStatus.IN_PROGRESS,
  ]) {
    if (alive.some((m) => m.status === status)) return status;
  }
  if (alive.every((m) => m.status === AppointmentStatus.NO_SHOW)) {
    return AppointmentStatus.NO_SHOW;
  }
  return alive.find((m) => ACTIVE.has(m.status))?.status ?? alive[0].status;
}

const present = (unit: Unit): HomeAppointment => ({
  startAt: unit.startAt,
  endAt: unit.endAt,
  clientName: unit.isClass ? null : unit.clientName,
  serviceName: unit.serviceName,
  isClass: unit.isClass,
});

/**
 * Monta o Início a partir dos agendamentos da semana, do mês e do mês anterior
 * (`rows`) e dos próximos agendamentos (`upcomingRows`, já a partir de amanhã).
 */
export function buildHome(
  rows: HomeRow[],
  upcomingRows: HomeRow[],
  now: Date,
  timeZone: string,
): ProfessionalHome {
  const range = homeRanges(now, timeZone);
  const units = toUnits(rows);
  const within = (date: Date, from: Date, to: Date) =>
    date >= from && date < to;

  // Hoje.
  const todayUnits = units.filter(
    (unit) =>
      within(unit.startAt, range.todayStart, range.tomorrowStart) &&
      unit.status !== AppointmentStatus.CANCELLED,
  );
  const remaining = todayUnits.filter(
    (unit) => ACTIVE.has(unit.status) && unit.endAt > now,
  );
  const next = remaining[0];

  // Semana: um item por dia, de segunda a domingo.
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(range.monday, index);
    const from = startOf(day, timeZone);
    const to = startOf(addDays(day, 1), timeZone);
    return {
      date: dayKey(day),
      count: units.filter(
        (unit) =>
          within(unit.startAt, from, to) &&
          unit.status !== AppointmentStatus.CANCELLED,
      ).length,
    };
  });

  // Mês e mês anterior.
  const monthRows = rows.filter((row) =>
    within(row.startAt, range.monthStart, range.nextMonthStart),
  );
  const completedIn = (from: Date, to: Date) =>
    units.filter(
      (unit) =>
        within(unit.startAt, from, to) &&
        unit.status === AppointmentStatus.COMPLETED,
    ).length;

  return {
    today: {
      total: todayUnits.length,
      remaining: remaining.length,
      next: next ? { ...present(next), inProgress: next.startAt <= now } : null,
    },
    week,
    month: {
      month: `${range.monthFirst.year}-${pad(range.monthFirst.month)}`,
      completed: completedIn(range.monthStart, range.nextMonthStart),
      noShow: monthRows.filter((r) => r.status === AppointmentStatus.NO_SHOW)
        .length,
      cancelled: monthRows.filter(
        (r) => r.status === AppointmentStatus.CANCELLED,
      ).length,
      clients: new Set(
        monthRows
          .filter((r) => r.status === AppointmentStatus.COMPLETED)
          .map((r) => r.clientId),
      ).size,
      previousCompleted: completedIn(
        range.previousMonthStart,
        range.monthStart,
      ),
    },
    upcoming: toUnits(upcomingRows).slice(0, NEXT_LIMIT).map(present),
  };
}
