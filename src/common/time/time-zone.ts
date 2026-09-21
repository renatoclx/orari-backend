/**
 * Conversões entre o horário local de uma empresa (fuso IANA, ex.:
 * "America/Sao_Paulo") e o instante em UTC gravado no banco.
 *
 * Todo instante continua sendo armazenado em UTC. O fuso só é usado para
 * interpretar horários "de parede": a janela de atendimento 09:00–18:00 e o
 * horário reservado por uma recorrência valem no relógio da empresa.
 *
 * A implementação usa o `Intl` do próprio Node, sem dependência externa.
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  // Criar um Intl.DateTimeFormat é caro; a agenda converte muitas datas seguidas.
  const cached = formatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  formatterCache.set(timeZone, formatter);

  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// Como o instante é lido no relógio da empresa.
export function toZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hours: parts.hour,
    minutes: parts.minute,
  };
}

// Diferença, em milissegundos, entre o relógio da empresa e o UTC naquele instante.
function offsetOf(date: Date, timeZone: string): number {
  const { year, month, day, hours, minutes } = toZonedParts(date, timeZone);
  const asUtc = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);

  // Segundos e milissegundos não entram no formatador, então são descartados
  // dos dois lados da conta.
  const withoutSeconds = Math.floor(date.getTime() / 60_000) * 60_000;

  return asUtc - withoutSeconds;
}

/**
 * Instante UTC correspondente a uma data e hora no relógio da empresa.
 *
 * O deslocamento é aplicado duas vezes porque ele próprio depende do instante:
 * em uma virada de horário de verão, o primeiro palpite pode cair do lado
 * errado da mudança. A segunda passada corrige esse caso.
 */
export function zonedToUtc(parts: ZonedParts, timeZone: string): Date {
  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hours,
    parts.minutes,
    0,
    0,
  );

  const firstOffset = offsetOf(new Date(guess), timeZone);
  const candidate = new Date(guess - firstOffset);
  const secondOffset = offsetOf(candidate, timeZone);

  return secondOffset === firstOffset
    ? candidate
    : new Date(guess - secondOffset);
}

// Minutos desde a meia-noite no relógio da empresa.
export function minutesOfZonedDay(date: Date, timeZone: string): number {
  const { hours, minutes } = toZonedParts(date, timeZone);

  return hours * 60 + minutes;
}

// Dia da semana (0 = domingo) de uma data do calendário, independente de fuso.
export function weekDayIndexOf({ year, month, day }: ZonedParts): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
