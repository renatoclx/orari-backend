import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from "class-validator";
import { isFilled } from "./is-filled";

export function ExactlyOneOf(
  properties: string[],
  validationOptions?: ValidationOptions,
) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: "exactlyOneOf",
      target: object.constructor,
      propertyName,
      constraints: [properties],
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const dto = args.object as Record<string, unknown>;
          return properties.filter((key) => isFilled(dto[key])).length === 1;
        },
        defaultMessage() {
          return `Informe exatamente um dos campos: ${properties.join(", ")}`;
        },
      },
    });
  };
}
