// Horários livres do portal, em minutos do dia no relógio da clínica. É a
// mesma regra que a tela da clínica usa (frontend: agenda-availability.ts),
// agora no servidor, porque o cliente não pode receber a agenda dos outros.

// Passo da grade de horários de início.
export const STEP_MINUTES = 15;
export const DAY_MINUTES = 24 * 60;

export interface Interval {
  start: number;
  end: number;
}

/**
 * Horários de início possíveis para um serviço de `duration` minutos.
 *
 * Candidatos: a grade de 15 minutos, o começo de cada janela e o fim de cada
 * compromisso do profissional (assim sobra o "horário quebrado": um serviço
 * curto cabe logo depois de outro). Vale o candidato em que o atendimento
 * inteiro cabe em UMA janela de atendimento, não sobrepõe compromisso do
 * profissional e não é anterior a `notBefore`.
 */
export function availableStarts({
  windows,
  busy,
  duration,
  notBefore,
}: {
  windows: Interval[];
  busy: Interval[];
  duration: number;
  notBefore: number;
}): number[] {
  const candidates = new Set<number>();
  for (const window of windows) {
    candidates.add(window.start);
    const first = Math.ceil(window.start / STEP_MINUTES) * STEP_MINUTES;
    for (let t = first; t < window.end; t += STEP_MINUTES) candidates.add(t);
  }
  for (const taken of busy) candidates.add(taken.end);

  return [...candidates]
    .filter((start) => {
      const end = start + duration;
      return (
        start >= notBefore &&
        windows.some((window) => start >= window.start && end <= window.end) &&
        !busy.some((other) => start < other.end && end > other.start)
      );
    })
    .sort((a, b) => a - b);
}

/**
 * Dias entre duas datas de calendário (sem horário): positivo se `to` vem
 * depois de `from`.
 */
export function daysBetween(
  from: { year: number; month: number; day: number },
  to: { year: number; month: number; day: number },
): number {
  const utc = (d: typeof from) => Date.UTC(d.year, d.month - 1, d.day);
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}
