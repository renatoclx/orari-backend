/**
 * Conversão entre o horário no formato "HH:MM" usado pela API e o `Date` que o
 * Prisma usa nas colunas `time` do Postgres.
 *
 * Em uma coluna `time` o banco guarda apenas o horário, mas o Prisma Client
 * representa o valor como `Date`. Usamos 1970-01-01 em UTC como data de
 * referência dos dois lados da conversão, para que só o horário seja relevante.
 */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// A data de referência é fixa e em UTC, para que o valor gravado não dependa
// do fuso do processo que está rodando a API.
export function parseTimeOfDay(value: string): Date {
  return new Date(`1970-01-01T${value}:00.000Z`);
}

// toISOString() sempre devolve "1970-01-01THH:MM:SS.sssZ" para este valor,
// então o horário está sempre nas mesmas posições da string.
export function formatTimeOfDay(value: Date): string {
  return value.toISOString().slice(11, 16);
}

/**
 * Dia da semana do enum WeekDay a partir do índice de `Date.getUTCDay()`
 * (0 = domingo). Usado para descobrir a janela de atendimento de uma data.
 */
export const WEEK_DAY_BY_INDEX = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;
