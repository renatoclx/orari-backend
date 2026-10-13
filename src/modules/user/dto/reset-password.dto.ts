import { Match } from "../../../common/validators/match.validator";
import { IsUserPassword } from "../decorators/is-user-password.decorator";

export class ResetPasswordDto {
  @IsUserPassword()
  newPassword!: string;

  /**
   * Confirmação: precisa ser igual à senha. Usado apenas na validação; nunca é
   * persistido.
   */
  // Ver docs/auth.md.
  @Match("newPassword")
  newPasswordConfirmation!: string;
}
