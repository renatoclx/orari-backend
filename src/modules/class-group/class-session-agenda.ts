import { BadRequestException } from "@nestjs/common";
import { AppointmentStatus, WeekDay } from "../../../generated/prisma/enums";
import {
  formatTimeOfDay,
  WEEK_DAY_BY_INDEX,
} from "../../common/time/time-of-day";
import { toZonedParts, zonedToUtc } from "../../common/time/time-zone";
import { CLASS_SESSIONS_RANGE_MAX_DAYS } from "./dto/find-class-sessions-query.dto";

/**
 * Cálculos da agenda por sessão (GET /class-sessions), sem acesso ao banco: o
 * ClassSessionService busca as turmas, as sessões e os agendamentos, e estas
 * funções montam os horários e as vagas.
 */

const DAY_MS = 86_400_000;

// Período da agenda: o fim depois do início, e no máximo 31 dias.
export function ensureAgendaRangeIsValid(from: Date, to: Date): void {
  if (to <= from) {
    throw new BadRequestException("to deve ser posterior a from");
  }
  if (to.getTime() - from.getTime() > CLASS_SESSIONS_RANGE_MAX_DAYS * DAY_MS) {
    throw new BadRequestException(
      `O período deve ter no máximo ${CLASS_SESSIONS_RANGE_MAX_DAYS} dias`,
    );
  }
}

/**
 * Inícios dos horários da turma entre `start` (incluído) e `to` (excluído),
 * percorrendo o calendário da empresa: "segunda às 08:00" é segunda no
 * relógio dela, convertida para UTC no fim.
 */
export function classGroupStartsOf(
  days: { weekDay: WeekDay; startTime: Date }[],
  start: Date,
  to: Date,
  timeZone: string,
): Date[] {
  const first = toZonedParts(start, timeZone);
  const last = toZonedParts(to, timeZone);
  const starts: Date[] = [];

  // Date.UTC só como calculadora de calendário (vira o mês, o ano bissexto etc.).
  for (
    let cursor = Date.UTC(first.year, first.month - 1, first.day);
    cursor <= Date.UTC(last.year, last.month - 1, last.day);
    cursor += DAY_MS
  ) {
    const date = new Date(cursor);
    const calendarDay = {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
    const weekDay = WEEK_DAY_BY_INDEX[date.getUTCDay()];

    for (const day of days.filter((item) => item.weekDay === weekDay)) {
      const [hours, minutes] = formatTimeOfDay(day.startTime)
        .split(":")
        .map(Number);
      const startAt = zonedToUtc({ ...calendarDay, hours, minutes }, timeZone);
      if (startAt >= start && startAt < to) {
        starts.push(startAt);
      }
    }
  }

  return starts;
}

/**
 * Horários da turma que ficam livres na agenda: sem sessão no mesmo início e
 * sem agendamento do profissional que os sobreponha.
 */
export function freeSlotsOf<
  Slot extends {
    group: { id: string; professionalId: string };
    startAt: Date;
    endAt: Date;
  },
>(
  slots: Slot[],
  taken: { classGroupId: string | null; startAt: Date }[],
  busy: { professionalId: string; startAt: Date; endAt: Date }[],
): Slot[] {
  return slots.filter(
    ({ group, startAt, endAt }) =>
      !taken.some(
        (session) =>
          session.classGroupId === group.id &&
          session.startAt.getTime() === startAt.getTime(),
      ) &&
      !busy.some(
        (appointment) =>
          appointment.professionalId === group.professionalId &&
          appointment.startAt < endAt &&
          appointment.endAt > startAt,
      ),
  );
}

/**
 * Vagas ocupadas (agendamentos não cancelados; a falta ocupa) e livres. A
 * sessão cancelada não tem vaga livre: não recebe mais alunos.
 */
export function seatsOf({
  capacity,
  cancelledAt,
  appointments,
}: {
  capacity: number;
  cancelledAt: Date | null;
  appointments: { status: AppointmentStatus }[];
}): { occupied: number; available: number } {
  const occupied = appointments.filter(
    (appointment) => appointment.status !== AppointmentStatus.CANCELLED,
  ).length;

  return {
    occupied,
    available: cancelledAt ? 0 : Math.max(capacity - occupied, 0),
  };
}
