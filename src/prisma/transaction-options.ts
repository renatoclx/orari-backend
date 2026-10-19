/**
 * Tempo máximo das transações longas: as que geram muitos agendamentos de uma
 * vez (criação de recorrência e contratação de plano), cada um validado contra
 * a agenda. As demais mantêm o padrão do Prisma (5 s), que serve de alarme
 * para uma transação comum que trave. Ver docs/technical-debt.md.
 */
export const LONG_TRANSACTION_TIMEOUT_MS = 30_000;
