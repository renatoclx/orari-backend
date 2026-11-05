import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";
import { Match } from "../../../common/validators/match.validator";
import { IsUserPassword } from "../../user/decorators/is-user-password.decorator";

// Conta nova do cliente no app: a senha segue a mesma regra dos usuários da clínica.
export class RegisterDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  /** Telefone com DDD (máscara e +55 são aceitos). É o login da conta. */
  @IsString()
  @MaxLength(30)
  phone!: string;

  @IsUserPassword()
  password!: string;

  // Só para a validação; nunca é gravada.
  @Match("password")
  passwordConfirmation!: string;
}
