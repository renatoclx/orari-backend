import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  Matches,
  ValidateIf,
} from "class-validator";
import { ContactType } from "../../../../generated/prisma/enums";
import { OwnerDto } from "../../../common/dto/owner.dto";
import { AtLeastOneOf } from "../../../common/validators/at-least-one-of.validator";
import { isFilled } from "../../../common/validators/is-filled";

// Telefone: DDD + número, só dígitos. Também usado no telefone principal da pessoa.
export const PHONE_PATTERN = /^\d{10,11}$/;
export const PHONE_MESSAGE =
  "phone deve conter 10 ou 11 dígitos numéricos (DDD + número)";

export class CreateContactDto extends OwnerDto {
  @IsEnum(ContactType)
  type!: ContactType;

  // Também valida quando nenhum meio é informado, para que AtLeastOneOf acuse a ausência.
  @ValidateIf(
    (dto: CreateContactDto) => isFilled(dto.phone) || !isFilled(dto.email),
  )
  @AtLeastOneOf(["phone", "email"])
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  /**
   * Contato exibido para o dono. Marcar um novo principal desmarca o anterior
   * do mesmo dono.
   */
  @IsOptional()
  @IsBoolean()
  isPrincipal?: boolean;
}
