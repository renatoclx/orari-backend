import { AppointmentStatus } from "../../../generated/prisma/enums";
import { toZonedParts } from "../../common/time/time-zone";
import {
  SUMMARY_LAST_HOUR,
  SUMMARY_MINUTE_OF_DAY,
} from "../auto-message/auto-message.catalog";

// Regras puras dos avisos ao profissional (lembrete 30 minutos antes e resumo
// da manhã), sem banco, para testar sem mock.

/** O que o lembrete precisa de cada agendamento. */
export interface ReminderRow {
  id: string;
  startAt: Date;
  professionalId: string;
  classSessionId: string | null;
  serviceName: string;
}

/** Um atendimento a lembrar: o avulso, ou a sessão de turma inteira. */
export interface ReminderUnit {
  professionalId: string;
  startAt: Date;
  serviceName: string;
  /** Chave do evento: a mesma para o mesmo atendimento, sempre. */
  key: string;
}

/**
 * Junta os alunos de uma sessão de turma num lembrete só: o profissional chega
 * à sessão uma vez, qualquer que seja o número de alunos.
 */
export function reminderUnits(rows: ReminderRow[]): ReminderUnit[] {
  const seen = new Set<string>();
  const units: ReminderUnit[] = [];
  for (const row of rows) {
    const key = row.classSessionId
      ? `class-session:${row.classSessionId}`
      : `appointment:${row.id}`;
    if (seen.has(`${row.professionalId}:${key}`)) continue;
    seen.add(`${row.professionalId}:${key}`);
    units.push({
      professionalId: row.professionalId,
      startAt: row.startAt,
      serviceName: row.serviceName,
      key,
    });
  }
  return units;
}

// Agendamentos que ainda vão acontecer (o lembrete só olha estes).
export const UPCOMING_STATUSES = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
];

/**
 * O resumo da manhã pode sair agora? Das 7h30 até as 11h no relógio da
 * clínica: a conferência roda a cada poucos minutos, então um reinício às 8h
 * ainda entrega o resumo do dia; depois das 11h ele não faz mais sentido.
 */
export function summaryWindowOpen(now: Date, timeZone: string): boolean {
  const { hours, minutes } = toZonedParts(now, timeZone);
  return (
    hours * 60 + minutes >= SUMMARY_MINUTE_OF_DAY && hours < SUMMARY_LAST_HOUR
  );
}

/** "1 atendimento" / "5 atendimentos": o valor de {quantidade} no resumo. */
export function attendanceCount(total: number): string {
  return total === 1 ? "1 atendimento" : `${total} atendimentos`;
}
