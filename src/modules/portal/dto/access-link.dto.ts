import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";
import { Match } from "../../../common/validators/match.validator";
import { IsUserPassword } from "../../user/decorators/is-user-password.decorator";

/** O token do link de acesso gerado pela clínica. */
export class CheckAccessLinkDto {
  @IsString()
  @MinLength(20)
  @MaxLength(100)
  token!: string;
}

/**
 * Uso do link. Com a conta entrada, basta o token. Sem ela, a senha cria a
 * conta (ou é a senha nova da conta que já existe); o telefone só é pedido
 * quando o cadastro na clínica não tem um (ver PortalAccessService.check).
 */
export class UseAccessLinkDto extends CheckAccessLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsUserPassword()
  password?: string;

  // Só para a validação; nunca é gravada. Exigida quando a senha vem.
  @ValidateIf((dto: UseAccessLinkDto) => dto.password !== undefined)
  @Match("password")
  passwordConfirmation?: string;
}
