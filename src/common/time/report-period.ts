import { BadRequestException } from "@nestjs/common";
import { toZonedParts, zonedToUtc } from "./time-zone";

// Período e séries dos relatórios (carteira, contas a receber, agendamentos):
// tudo em dias do relógio da empresa.

const DAY_MS = 24 * 60 * 60 * 1000;

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

export const dayString = ({ year, month, day }: Day) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

// Dias corridos desde 1970, para contar a distância entre dois dias.
const dayNumber = ({ year, month, day }: Day) =>
  Math.round(Date.UTC(year, month - 1, day) / DAY_MS);

/** Período em instantes: início incluído, fim excluído. */
export interface Period {
  start: Date;
  end: Date;
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

// Acima disso, os gráficos agrupam por semana (barras por dia ficariam finas demais).
export const DAILY_SERIES_MAX_DAYS = 62;

/** Quadro de uma série: os intervalos (com os vazios) e onde cai cada instante. */
export interface SeriesFrame {
  unit: "day" | "week";
  /** Primeiro dia de cada intervalo, AAAA-MM-DD no fuso da empresa. */
  dates: string[];
  /** Índice do intervalo do instante, ou -1 fora do período. */
  indexOf: (instant: Date) => number;
}

/**
 * Intervalos do gráfico de um período: um por dia (até 62 dias) ou por semana
 * de 7 dias contada do início do período. Os dias são os da empresa: um
 * atendimento às 22h em UTC-3 conta no próprio dia, não no seguinte.
 */
export function seriesFrame(period: Period, timeZone: string): SeriesFrame {
  const first = toZonedParts(period.start, timeZone);
  const last = toZonedParts(new Date(period.end.getTime() - 1), timeZone);
  const totalDays = dayNumber(last) - dayNumber(first) + 1;
  const unit = totalDays > DAILY_SERIES_MAX_DAYS ? "week" : "day";
  const size = unit === "week" ? 7 : 1;

  const dates = Array.from({ length: Math.ceil(totalDays / size) }, (_, i) => {
    const date = new Date(
      Date.UTC(first.year, first.month - 1, first.day + i * size),
    );
    return dayString({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    });
  });

  return {
    unit,
    dates,
    indexOf: (instant) => {
      const index = Math.floor(
        (dayNumber(toZonedParts(instant, timeZone)) - dayNumber(first)) / size,
      );
      return index >= 0 && index < dates.length ? index : -1;
    },
  };
}
