import { IsNotEmpty, IsString } from "class-validator";
import { Match } from "../../../common/validators/match.validator";
import { IsUserPassword } from "../../user/decorators/is-user-password.decorator";

/** Troca da própria senha: pede a atual, para uma sessão esquecida aberta não bastar. */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: "Informe a senha atual" })
  currentPassword!: string;

  @IsUserPassword()
  newPassword!: string;

  /** Só para a validação; nunca é gravada. */
  @Match("newPassword")
  newPasswordConfirmation!: string;
}
