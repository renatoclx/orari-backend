import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from "class-validator";

// Decorator de propriedade: válido quando o valor for idêntico ao de `property`
// no mesmo DTO (ex.: passwordConfirmation === password).
export function Match(property: string, validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: "match",
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const dto = args.object as Record<string, unknown>;
          return value === dto[property];
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} deve ser igual a ${property}`;
        },
      },
    });
  };
}
