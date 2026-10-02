// Checagem explícita de undefined/null, em vez de `!value`: um `!value` trataria
// valores válidos como 0, "" ou false como "não preenchido".
export const isFilled = (value: unknown) =>
  value !== undefined && value !== null;
