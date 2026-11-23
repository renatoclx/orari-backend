import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { Match } from "../../../common/validators/match.validator";
import { IsUserPassword } from "../../user/decorators/is-user-password.decorator";

// Senha nova pelo link do e-mail ("Esqueci minha senha").
export class PasswordResetDto {
  /** O token que veio no link. */
  @IsString()
  @IsNotEmpty({ message: "Link inválido" })
  @MaxLength(100)
  token!: string;

  @IsUserPassword()
  newPassword!: string;

  /** Só para a validação; nunca é gravada. */
  @Match("newPassword")
  newPasswordConfirmation!: string;
}
