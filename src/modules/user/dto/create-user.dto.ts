import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";
import { UserType } from "../../../../generated/prisma/enums";
import { Match } from "../../../common/validators/match.validator";
import { IsUserPassword } from "../decorators/is-user-password.decorator";

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEmail()
  email!: string;

  @IsUserPassword()
  password!: string;

  /**
   * Confirmação: precisa ser igual à senha. Usado apenas na validação; nunca é
   * persistido.
   */
  // Ver docs/auth.md.
  @Match("password")
  passwordConfirmation!: string;

  @IsEnum(UserType)
  type!: UserType;

  /**
   * Obrigatório para SUPER_ADMIN. Para ADMIN, se informado, deve ser a própria
   * empresa.
   */
  // A regra depende de quem está autenticado e por isso fica no UserService.
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
