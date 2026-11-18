import { Transform } from "class-transformer";
import {
  Equals,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { SubscriptionPlan } from "../../../../generated/prisma/enums";
import { IsCpfOrCnpj } from "../../../common/validators/document.validator";
import { IsUserPassword } from "../../user/decorators/is-user-password.decorator";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

// Cadastro sozinho da empresa, pela landing (rota pública, com limite por IP).
export class SignupDto {
  /** Nome do negócio (vira a razão social; para CPF, pode ser o nome da pessoa). */
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: "Informe o nome do negócio" })
  @MaxLength(100)
  companyName!: string;

  // O CNPJ alfanumérico usa letras maiúsculas; normalizar evita recusar por caixa.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toUpperCase() : value,
  )
  @IsCpfOrCnpj()
  document!: string;

  /** Quem vai administrar a conta. */
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: "Informe o seu nome" })
  @MaxLength(100)
  name!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: "Informe um e-mail válido" })
  email!: string;

  /** Celular com DDD, só dígitos (o contato principal da empresa). */
  @Matches(/^\d{10,11}$/, { message: "Informe o celular com DDD" })
  phone!: string;

  @IsUserPassword()
  password!: string;

  /** Plano escolhido na landing; o teste vale com os acessos dele. */
  @IsIn(Object.values(SubscriptionPlan), { message: "Plano inválido" })
  plan!: SubscriptionPlan;

  /** Aceite dos termos de uso e da política de privacidade. */
  @Equals(true, { message: "É preciso aceitar os termos para continuar" })
  acceptTerms!: boolean;
}
