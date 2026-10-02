import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from "class-validator";
import { isFilled } from "./is-filled";

// Decorator de propriedade: válido quando ao menos uma das `properties`
// informadas no DTO estiver preenchida (ex.: Contact exige phone e/ou email).
export function AtLeastOneOf(
  properties: string[],
  validationOptions?: ValidationOptions,
) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: "atLeastOneOf",
      target: object.constructor,
      propertyName,
      constraints: [properties],
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const dto = args.object as Record<string, unknown>;
          return properties.some((key) => isFilled(dto[key]));
        },
        defaultMessage() {
          return `Informe ao menos um dos campos: ${properties.join(", ")}`;
        },
      },
    });
  };
}
