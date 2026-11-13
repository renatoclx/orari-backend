import type { SummaryItem } from "../auto-message/auto-message.catalog";

// Regras puras do resumo de pendências do administrador (sem banco).

/** A funcionalidade do plano que alimenta cada item (sem ela, o item não entra). */
export const SUMMARY_ITEM_FEATURE: Record<SummaryItem, string> = {
  PAYABLE_TODAY: "payables",
  PAYABLE_OVERDUE: "payables",
  RECEIVABLE_OVERDUE: "payments",
  OPEN_TABS: "tabs",
  BIRTHDAYS: "clients",
};

// A frase de cada item, no singular e no plural.
const PHRASES: Record<SummaryItem, [string, string]> = {
  PAYABLE_TODAY: ["conta a pagar hoje", "contas a pagar hoje"],
  PAYABLE_OVERDUE: ["conta atrasada", "contas atrasadas"],
  RECEIVABLE_OVERDUE: ["recebimento atrasado", "recebimentos atrasados"],
  OPEN_TABS: ["comanda hoje", "comandas hoje"],
  BIRTHDAYS: ["aniversariante", "aniversariantes"],
};

export interface SummaryCount {
  item: SummaryItem;
  count: number;
}

/** "1 conta atrasada" / "3 contas atrasadas". */
export function itemPhrase({ item, count }: SummaryCount): string {
  const [singular, plural] = PHRASES[item];
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "a", "a e b", "a, b e c". */
export function joinPhrases(phrases: string[]): string {
  if (phrases.length <= 1) return phrases[0] ?? "";
  return `${phrases.slice(0, -1).join(", ")} e ${phrases.at(-1)}`;
}

/** A frase do {resumo}: só os itens com número (o que não tem não aparece). */
export function summaryText(counts: SummaryCount[]): string {
  return joinPhrases(
    counts.filter(({ count }) => count > 0).map((entry) => itemPhrase(entry)),
  );
}
