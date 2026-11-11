import type { AutoMessageKind } from "../../../generated/prisma/enums";

// Situações das mensagens automáticas, seus padrões e suas opções (ver
// docs/business-rules/mensagens.md, "Mensagens automáticas").

export const AUTO_MESSAGE_KINDS = [
  "REMINDER",
  "APPOINTMENT_CREATED",
  "APPOINTMENT_RESCHEDULED",
  "APPOINTMENT_CANCELLED",
  "BIRTHDAY",
  "MISS_YOU",
] as const satisfies readonly AutoMessageKind[];

// Variáveis de toda situação e as que só existem quando há um agendamento.
const PERSON_VARIABLES = ["nome", "estabelecimento"] as const;
const APPOINTMENT_VARIABLES = [
  ...PERSON_VARIABLES,
  "data",
  "hora",
  "servico",
  "profissional",
] as const;
export type MessageVariable = (typeof APPOINTMENT_VARIABLES)[number];

// Tempos do lembrete (minutos antes): 30 min, 1h, 2h, 24h e 48h.
export const REMINDER_OFFSETS = [30, 60, 120, 1440, 2880] as const;
// Dias sem vir para o "sentimos sua falta".
export const MISS_YOU_DAYS = [15, 30, 45, 60, 90] as const;

export interface AutoMessageSettings {
  kind: AutoMessageKind;
  enabled: boolean;
  body: string;
  reminderOffsets: number[];
  missYouDays: number | null;
}

interface KindDefinition {
  variables: readonly MessageVariable[];
  defaults: Omit<AutoMessageSettings, "kind">;
}

/**
 * Padrão de quem nunca salvou: lembrete (24h e 30 min) e os avisos de
 * agendamento ligados; aniversário e "sentimos sua falta" desligados, porque
 * são marketing e a clínica escolhe o texto.
 */
export const AUTO_MESSAGE_CATALOG: Record<AutoMessageKind, KindDefinition> = {
  REMINDER: {
    variables: APPOINTMENT_VARIABLES,
    defaults: {
      enabled: true,
      body: "Olá, {nome}! Lembrete: {servico} com {profissional} em {data} às {hora}.",
      reminderOffsets: [1440, 30],
      missYouDays: null,
    },
  },
  APPOINTMENT_CREATED: {
    variables: APPOINTMENT_VARIABLES,
    defaults: {
      enabled: true,
      body: "Olá, {nome}! Seu horário foi marcado: {servico} com {profissional} em {data} às {hora}.",
      reminderOffsets: [],
      missYouDays: null,
    },
  },
  APPOINTMENT_RESCHEDULED: {
    variables: APPOINTMENT_VARIABLES,
    defaults: {
      enabled: true,
      body: "Olá, {nome}! Seu horário mudou: {servico} com {profissional} agora é em {data} às {hora}.",
      reminderOffsets: [],
      missYouDays: null,
    },
  },
  APPOINTMENT_CANCELLED: {
    variables: APPOINTMENT_VARIABLES,
    defaults: {
      enabled: true,
      body: "Olá, {nome}. Seu horário de {servico} em {data} às {hora} foi cancelado. Fale com a gente para remarcar.",
      reminderOffsets: [],
      missYouDays: null,
    },
  },
  BIRTHDAY: {
    variables: PERSON_VARIABLES,
    defaults: {
      enabled: false,
      body: "Feliz aniversário, {nome}! A equipe do {estabelecimento} deseja um ótimo dia.",
      reminderOffsets: [],
      missYouDays: null,
    },
  },
  MISS_YOU: {
    variables: PERSON_VARIABLES,
    defaults: {
      enabled: false,
      body: "Olá, {nome}! Sentimos sua falta no {estabelecimento}. Que tal agendar um horário?",
      reminderOffsets: [],
      missYouDays: 30,
    },
  },
};

export function defaultSettings(kind: AutoMessageKind): AutoMessageSettings {
  return { kind, ...AUTO_MESSAGE_CATALOG[kind].defaults };
}
