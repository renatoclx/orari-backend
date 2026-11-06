import type { AutoMessageKind } from "../../../generated/prisma/enums";
import {
  AUTO_MESSAGE_CATALOG,
  type MessageVariable,
} from "./auto-message.catalog";

// Uma variável é um nome entre chaves, sem espaços: {nome}, {data}.
const VARIABLE = /\{([^{}\s]+)\}/g;

/** Variáveis do texto que não existem na situação (para o 400 do salvar). */
export function unknownVariables(
  body: string,
  kind: AutoMessageKind,
): string[] {
  const allowed: readonly string[] = AUTO_MESSAGE_CATALOG[kind].variables;
  const found = [...body.matchAll(VARIABLE)].map((match) => match[1]);
  return [...new Set(found.filter((name) => !allowed.includes(name)))];
}

/**
 * Troca as variáveis pelos valores. Uma variável sem valor (o salvar já barra
 * as desconhecidas) fica como está, em vez de sumir do texto.
 */
export function renderMessage(
  body: string,
  values: Partial<Record<MessageVariable, string>>,
): string {
  return body.replace(VARIABLE, (whole, name: string) =>
    name in values ? (values[name as MessageVariable] ?? whole) : whole,
  );
}

/** "Maria Clara Souza" → "Maria". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
