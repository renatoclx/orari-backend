/**
 * Normaliza um texto para busca: remove acentos e converte para minúsculas.
 *
 * É aplicada tanto ao valor gravado nas colunas `normalizedName` quanto ao termo
 * pesquisado, para que "sao paulo" encontre "São Paulo". A decomposição NFD separa
 * cada letra de seu acento (ex.: "ã" → "a" + "~"), e os acentos (marcas
 * combinantes, categoria Unicode M) são descartados em seguida.
 *
 * Deve produzir o mesmo resultado que `lower(unaccent(...))` do Postgres para
 * nomes em português, usado apenas no preenchimento inicial da migration.
 */
export function normalizeForSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}
