import { IsString, MaxLength } from "class-validator";
import { Match } from "../../../common/validators/match.validator";
import { IsUserPassword } from "../../user/decorators/is-user-password.decorator";

export class ChangePasswordDto {
  @IsString()
  @MaxLength(72)
  currentPassword!: string;

  @IsUserPassword()
  newPassword!: string;

  // Só para a validação; nunca é gravada.
  @Match("newPassword")
  newPasswordConfirmation!: string;
}
