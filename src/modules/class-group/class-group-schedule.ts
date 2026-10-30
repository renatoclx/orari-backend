import { WeekDay } from "../../../generated/prisma/enums";
import { toZonedParts } from "../../common/time/time-zone";

// Nome do dia nas mensagens de erro.
export const WEEK_DAY_LABEL: Record<WeekDay, string> = {
  MONDAY: "segunda-feira",
  TUESDAY: "terça-feira",
  WEDNESDAY: "quarta-feira",
  THURSDAY: "quinta-feira",
  FRIDAY: "sexta-feira",
  SATURDAY: "sábado",
  SUNDAY: "domingo",
};

// "HH:MM" em minutos desde a meia-noite.
export function minutesOf(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

// Minutos desde a meia-noite em "HH:MM".
export function formatMinutes(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

// Data e hora no fuso da empresa, para as mensagens (ex.: "02/11/2026 às 08:00").
export function formatZonedDateTime(date: Date, timeZone: string): string {
  const { day, month, year, hours, minutes } = toZonedParts(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(day)}/${pad(month)}/${year} às ${pad(hours)}:${pad(minutes)}`;
}
