import { registerDecorator, ValidationOptions } from "class-validator";
import { isValidTimeZone } from "../time/time-zone";

// Aceita identificadores reconhecidos pelo Intl (ex.: "America/Sao_Paulo").
export function IsTimeZone(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: "isTimeZone",
      target: object.constructor,
      propertyName,
      options: {
        message: "$property deve ser um fuso horário IANA válido",
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === "string" && isValidTimeZone(value),
      },
    });
  };
}
