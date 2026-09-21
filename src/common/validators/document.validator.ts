import { registerDecorator, ValidationOptions } from "class-validator";

/**
 * Calcula um dígito verificador pelo módulo 11, regra comum a CPF e CNPJ.
 *
 * Cada caractere vale `código ASCII - 48`: para dígitos isso é o próprio número,
 * e para letras (CNPJ alfanumérico) resulta em A=17 … Z=42, conforme a
 * especificação da Receita Federal. Assim o mesmo cálculo atende os dois formatos.
 */
function checkDigit(
  chars: string,
  weights: number[],
  toDigit: (rest: number) => number,
) {
  const sum = weights.reduce(
    (total, weight, index) => total + (chars.charCodeAt(index) - 48) * weight,
    0,
  );
  return toDigit(sum % 11);
}

// Sequências repetidas (ex.: 11111111111) passam no cálculo, mas não são documentos válidos.
const isRepeatedSequence = (value: string) => /^(.)\1+$/.test(value);

/**
 * CPF: 11 dígitos, sem máscara. Pesos decrescentes a partir de 10 (1º DV) e 11 (2º DV);
 * o dígito é `(soma * 10) % 11`, e o resultado 10 vira 0.
 */
export function isValidCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || isRepeatedSequence(value)) {
    return false;
  }

  const toDigit = (rest: number) => ((rest * 10) % 11) % 10;
  const weights = (start: number) =>
    Array.from({ length: start - 1 }, (_, index) => start - index);

  const first = checkDigit(value.slice(0, 9), weights(10), toDigit);
  const second = checkDigit(value.slice(0, 10), weights(11), toDigit);

  return value.endsWith(`${first}${second}`);
}

const CNPJ_FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_SECOND_WEIGHTS = [6, ...CNPJ_FIRST_WEIGHTS];

/**
 * CNPJ: 14 caracteres, sem máscara, em maiúsculas. Aceita o formato numérico
 * tradicional e o alfanumérico (a partir de jul/2026): 12 caracteres [0-9A-Z]
 * seguidos de 2 dígitos verificadores numéricos. O resto < 2 gera dígito 0;
 * caso contrário, o dígito é `11 - resto`.
 */
export function isValidCnpj(value: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(value) || isRepeatedSequence(value)) {
    return false;
  }

  const toDigit = (rest: number) => (rest < 2 ? 0 : 11 - rest);

  const first = checkDigit(value.slice(0, 12), CNPJ_FIRST_WEIGHTS, toDigit);
  const second = checkDigit(value.slice(0, 13), CNPJ_SECOND_WEIGHTS, toDigit);

  return value.endsWith(`${first}${second}`);
}

function documentDecorator(
  name: string,
  isValid: (value: string) => boolean,
  message: string,
  validationOptions?: ValidationOptions,
) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name,
      target: object.constructor,
      propertyName,
      options: { message, ...validationOptions },
      validator: {
        validate: (value: unknown) =>
          typeof value === "string" && isValid(value),
      },
    });
  };
}

export const IsCpf = (validationOptions?: ValidationOptions) =>
  documentDecorator(
    "isCpf",
    isValidCpf,
    "$property deve ser um CPF válido, com 11 dígitos e sem máscara",
    validationOptions,
  );

export const IsCnpj = (validationOptions?: ValidationOptions) =>
  documentDecorator(
    "isCnpj",
    isValidCnpj,
    "$property deve ser um CNPJ válido (numérico ou alfanumérico), com 14 caracteres e sem máscara",
    validationOptions,
  );
