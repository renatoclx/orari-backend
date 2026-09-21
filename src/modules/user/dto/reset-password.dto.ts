import { Match } from "../../../common/validators/match.validator";
import { IsUserPassword } from "../decorators/is-user-password.decorator";

export class ResetPasswordDto {
  @IsUserPassword()
  newPassword!: string;

  // Usado apenas na validação; nunca é persistido (ver docs/auth.md).
  @Match("newPassword")
  newPasswordConfirmation!: string;
}
