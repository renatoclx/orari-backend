// Ficha substituída (ver docs/business-rules/anamnese.md, "Fichas e
// acompanhamentos"): quando o cliente atualiza a ficha para a versão nova do
// modelo, a antiga sai das listas e fica só para consulta. Não há coluna para
// isso: é substituída a ficha que tem outra do mesmo cliente e modelo numa
// versão maior.

export interface FichaVersion {
  id: string;
  templateId: string;
  version: number;
}

/** Só as fichas atuais: a de maior versão de cada modelo. */
export function currentFichas<T extends FichaVersion>(fichas: T[]): T[] {
  const latest = new Map<string, T>();
  for (const ficha of fichas) {
    const kept = latest.get(ficha.templateId);
    if (!kept || ficha.version > kept.version) {
      latest.set(ficha.templateId, ficha);
    }
  }
  return fichas.filter((ficha) => latest.get(ficha.templateId) === ficha);
}

/**
 * Para a ficha `self`, entre as do mesmo cliente e modelo (`siblings`, sem ela):
 * a atual que a substitui (nula se ela é a atual) e as versões anteriores, da
 * mais recente para a mais antiga.
 */
export function replacementOf(
  self: { version: number },
  siblings: { id: string; version: number }[],
): {
  replacedBy: { id: string; version: number } | null;
  previous: { id: string; version: number }[];
} {
  const newer = siblings.filter((item) => item.version > self.version);
  const replacedBy = newer.reduce<{ id: string; version: number } | null>(
    (best, item) => (!best || item.version > best.version ? item : best),
    null,
  );
  const previous = siblings
    .filter((item) => item.version < self.version)
    .sort((a, b) => b.version - a.version);
  return { replacedBy, previous };
}
