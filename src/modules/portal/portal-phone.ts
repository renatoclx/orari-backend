/**
 * Telefone digitado pelo cliente no formato dos contatos (DDD + número, só
 * dígitos, 10 ou 11). Aceita máscara e o código do país (55). Fora disso,
 * devolve `undefined`.
 */
export function normalizePortalPhone(input: string): string | undefined {
  let digits = input.replace(/\D/g, "");
  if (
    (digits.length === 12 || digits.length === 13) &&
    digits.startsWith("55")
  ) {
    digits = digits.slice(2);
  }
  return /^\d{10,11}$/.test(digits) ? digits : undefined;
}
