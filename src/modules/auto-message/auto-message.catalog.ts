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
  // Avisos ao profissional que usa o app, não ao cliente.
  "PROFESSIONAL_REMINDER",
  "PROFESSIONAL_SUMMARY",
  // Ao administrador da clínica.
  "ADMIN_SUMMARY",
] as const satisfies readonly AutoMessageKind[];

// As situações que vão ao cliente (as de sempre) e as que vão ao profissional.
export const PROFESSIONAL_KINDS = [
  "PROFESSIONAL_REMINDER",
  "PROFESSIONAL_SUMMARY",
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
// O resumo da manhã: sem agendamento específico, mas com o dia, o primeiro
// horário e quantos atendimentos há.
const SUMMARY_VARIABLES = [
  ...PERSON_VARIABLES,
  "data",
  "hora",
  "quantidade",
] as const;
// O resumo de pendências do administrador: {resumo} é a frase pronta
// ("3 contas a pagar hoje, 2 recebimentos atrasados e 4 aniversariantes").
const ADMIN_VARIABLES = [...PERSON_VARIABLES, "data", "resumo"] as const;
export type MessageVariable =
  | (typeof APPOINTMENT_VARIABLES)[number]
  | (typeof SUMMARY_VARIABLES)[number]
  | (typeof ADMIN_VARIABLES)[number];

// Itens do resumo de pendências do administrador (cada um confere a
// funcionalidade do plano que o alimenta) e as horas possíveis do envio.
export const SUMMARY_ITEMS = [
  "PAYABLE_TODAY",
  "PAYABLE_OVERDUE",
  "RECEIVABLE_OVERDUE",
  "OPEN_TABS",
  "BIRTHDAYS",
] as const;
export type SummaryItem = (typeof SUMMARY_ITEMS)[number];
export const SUMMARY_HOURS = [7, 8, 9, 10] as const;
// O resumo do administrador pode sair até o meio-dia (um reinício da API ainda entrega).
export const ADMIN_SUMMARY_LAST_HOUR = 12;

// O lembrete do profissional sai sempre 30 minutos antes (fixo, sem opção).
export const PROFESSIONAL_REMINDER_MINUTES = 30;
// E o resumo da manhã, às 7h30 no relógio da clínica, até as 11h.
export const SUMMARY_MINUTE_OF_DAY = 7 * 60 + 30;
export const SUMMARY_LAST_HOUR = 11;

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
  /** Resumo do administrador: a hora do envio e os itens que entram. */
  summaryHour: number | null;
  summaryItems: string[];
}

interface KindDefinition {
  variables: readonly MessageVariable[];
  // As opções do resumo do administrador só existem nele.
  defaults: Omit<AutoMessageSettings, "kind" | "summaryHour" | "summaryItems"> &
    Partial<Pick<AutoMessageSettings, "summaryHour" | "summaryItems">>;
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
  // Ao profissional: ligados por padrão. O texto não leva o nome do cliente (o
  // aviso aparece na tela bloqueada do celular).
  PROFESSIONAL_REMINDER: {
    variables: APPOINTMENT_VARIABLES,
    defaults: {
      enabled: true,
      body: "Seu próximo atendimento é {servico}, hoje às {hora}.",
      reminderOffsets: [],
      missYouDays: null,
    },
  },
  PROFESSIONAL_SUMMARY: {
    variables: SUMMARY_VARIABLES,
    defaults: {
      enabled: true,
      body: "Bom dia, {nome}! Hoje você tem {quantidade}, o primeiro às {hora}.",
      reminderOffsets: [],
      missYouDays: null,
    },
  },
  // Ao administrador: ligado, às 8h, com todos os itens que o plano libera.
  ADMIN_SUMMARY: {
    variables: ADMIN_VARIABLES,
    defaults: {
      enabled: true,
      body: "Bom dia, {nome}! Hoje: {resumo}.",
      reminderOffsets: [],
      missYouDays: null,
      summaryHour: 8,
      summaryItems: [...SUMMARY_ITEMS],
    },
  },
};

export function defaultSettings(kind: AutoMessageKind): AutoMessageSettings {
  return {
    kind,
    summaryHour: null,
    summaryItems: [],
    ...AUTO_MESSAGE_CATALOG[kind].defaults,
  };
}
