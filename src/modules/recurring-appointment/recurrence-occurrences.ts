import { minutesOf, WEEK_DAY_BY_INDEX } from "../../common/time/time-of-day";
import {
  toZonedParts,
  weekDayIndexOf,
  zonedToUtc,
} from "../../common/time/time-zone";
import type { AppointmentOccurrence } from "../appointment/appointment.service";
import type { RecurringDayDto } from "./dto/recurring-day.dto";

/*
 * Calendário da recorrência, sem acesso ao banco: os horários que ela ocupa e
 * as comparações de datas puras (coluna `date`) usadas nas validações do
 * RecurringAppointmentService.
 */

/**
 * Monta os horários que a recorrência ocupa.
 *
 * Gera do maior valor entre o início da recorrência e hoje (não se cria
 * histórico) até a data final. Cada ocorrência começa no horário reservado do
 * dia e termina conforme a duração do serviço. `from` é o instante atual.
 */
export function buildOccurrences(
  days: RecurringDayDto[],
  startDate: Date,
  endDate: Date,
  serviceDuration: number,
  timeZone: string,
  from: Date,
): AppointmentOccurrence[] {
  /*
   * O calendário percorrido é o da empresa: "toda terça às 14h" é terça no
   * relógio dela, e cada horário vira um instante UTC no fim.
   *
   * startDate e endDate são datas puras (coluna `date`), então entram pelo
   * calendário, sem conversão de fuso — convertê-las deslocaria o dia (em
   * UTC-3, "2026-12-15" viraria 14/12 às 21h e perderia o último dia).
   * `from` é um instante, e por isso é lido no fuso da empresa.
   *
   * O início é o maior dos dois como dia de calendário. Comparar a data pura
   * com o instante não serve: à noite, quando em UTC já é o dia seguinte, a
   * meia-noite UTC da data de início ficaria "no passado" e a geração
   * começaria no dia anterior ao contratado.
   */
  const start = toDateParts(startDate);
  const today = toZonedParts(from, timeZone);
  const cursor = isBeforeOrSameDay(today, start) ? start : today;

  // A geração termina na data final, que é obrigatória (não há mais horizonte).
  const limit = toDateParts(endDate);
  const occurrences: AppointmentOccurrence[] = [];

  while (isBeforeOrSameDay(cursor, limit)) {
    const weekDay = WEEK_DAY_BY_INDEX[weekDayIndexOf(cursor)];

    for (const day of days.filter((item) => item.weekDay === weekDay)) {
      const [hours, minutes] = day.startTime.split(":").map(Number);
      const startAt = zonedToUtc({ ...cursor, hours, minutes }, timeZone);

      // Uma ocorrência que já passou não é criada.
      if (startAt > from) {
        occurrences.push({
          startAt,
          endAt: new Date(startAt.getTime() + serviceDuration * 60_000),
        });
      }
    }

    advanceOneDay(cursor);
  }

  return occurrences;
}

/*
 * As funções abaixo (toDateParts, isBeforeOrSameDay e advanceOneDay, com o
 * weekDayIndexOf de common/time) formam um pequeno "kit de calendário"
 * usado só pelo buildOccurrences, para andar dia a dia entre o início e o
 * fim da recorrência.
 *
 * Por que não usar `Date` diretamente como cursor? Porque `Date` representa
 * um instante (amarrado a um fuso), e o que se quer aqui é andar por dias de
 * calendário "puros" (2026-10-01, 2026-10-02, ...), sem hora nem fuso — do
 * contrário, perto da virada do dia no fuso da empresa, o cursor correria o
 * risco de pular ou repetir um dia (mesmo problema explicado para
 * `startDate`/`endDate` no comentário de buildOccurrences). Por isso o
 * cursor é um objeto simples `{ year, month, day }`, e `Date.UTC(...)` entra
 * só como calculadora (ela já sabe lidar com "dia 32" virando o mês
 * seguinte, ano bissexto etc.), nunca como o valor guardado.
 */

// Data pura (coluna `date`): o dia é o que está gravado, sem conversão de fuso.
export function toDateParts(value: Date) {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
    hours: 0,
    minutes: 0,
  };
}

export function isBeforeOrSameDay(
  cursor: { year: number; month: number; day: number },
  limit: { year: number; month: number; day: number },
): boolean {
  return (
    Date.UTC(cursor.year, cursor.month - 1, cursor.day) <=
    Date.UTC(limit.year, limit.month - 1, limit.day)
  );
}

function advanceOneDay(cursor: {
  year: number;
  month: number;
  day: number;
}): void {
  const next = new Date(
    Date.UTC(cursor.year, cursor.month - 1, cursor.day + 1),
  );
  cursor.year = next.getUTCFullYear();
  cursor.month = next.getUTCMonth() + 1;
  cursor.day = next.getUTCDate();
}

export function minutesBetween(startTime: string, endTime: string): number {
  return minutesOf(endTime) - minutesOf(startTime);
}
