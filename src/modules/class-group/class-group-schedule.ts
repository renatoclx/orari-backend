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

// Data e hora no fuso da empresa, para as mensagens (ex.: "02/11/2026 às 08:00").
export function formatZonedDateTime(date: Date, timeZone: string): string {
  const { day, month, year, hours, minutes } = toZonedParts(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(day)}/${pad(month)}/${year} às ${pad(hours)}:${pad(minutes)}`;
}
