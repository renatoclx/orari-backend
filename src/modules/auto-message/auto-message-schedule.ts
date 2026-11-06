import { toZonedParts } from "../../common/time/time-zone";

// Janelas de tempo das mensagens automáticas, sempre no relógio da clínica.

// O lembrete sai até 15 minutos depois do momento certo; mais tarde, não sai
// (ex.: o "24h antes" de um horário marcado com 2h de antecedência).
export const REMINDER_GRACE_MINUTES = 15;

// Hora local em que saem o aniversário e o "sentimos sua falta".
export const BIRTHDAY_HOUR = 9;
export const MISS_YOU_HOUR = 10;

const MINUTE = 60_000;

/**
 * Intervalo de inícios cujo lembrete de `offset` minutos deve sair agora:
 * o momento do lembrete (início − offset) já chegou, há no máximo 15 minutos.
 */
export function reminderStartRange(
  now: Date,
  offsetMinutes: number,
): { after: Date; until: Date } {
  return {
    after: new Date(
      now.getTime() + (offsetMinutes - REMINDER_GRACE_MINUTES) * MINUTE,
    ),
    until: new Date(now.getTime() + offsetMinutes * MINUTE),
  };
}

/** Data de calendário "aaaa-mm-dd" de um instante no fuso. */
export function localDate(instant: Date, timeZone: string): string {
  const { year, month, day } = toZonedParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function localHour(instant: Date, timeZone: string): number {
  return toZonedParts(instant, timeZone).hours;
}

/** "2026-11-05" − 30 dias → "2026-10-06" (aritmética de calendário). */
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

const isLeapYear = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * Faz aniversário hoje? A data de nascimento é só de calendário (gravada à
 * meia-noite UTC). Quem nasceu em 29/02 comemora em 28/02 fora dos anos
 * bissextos.
 */
export function isBirthday(birthDate: Date, today: string): boolean {
  const [year, month, day] = today.split("-").map(Number);
  const birthMonth = birthDate.getUTCMonth() + 1;
  const birthDay = birthDate.getUTCDate();
  if (birthMonth === 2 && birthDay === 29 && !isLeapYear(year)) {
    return month === 2 && day === 28;
  }
  return month === birthMonth && day === birthDay;
}

/** Dia e mês do agendamento no fuso: "12/11". */
export function formatDayMonth(instant: Date, timeZone: string): string {
  const { month, day } = toZonedParts(instant, timeZone);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

export function formatTime(instant: Date, timeZone: string): string {
  const { hours, minutes } = toZonedParts(instant, timeZone);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
