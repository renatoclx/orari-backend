import {
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

export class CreateContactDto extends OwnerDto {
  @IsEnum(ContactType)
  type!: ContactType;

  // Também valida quando nenhum meio é informado, para que AtLeastOneOf acuse a ausência.
  @ValidateIf(
    (dto: CreateContactDto) => isFilled(dto.phone) || !isFilled(dto.email),
  )
  @AtLeastOneOf(["phone", "email"])
  @Matches(/^\d{10,11}$/, {
    message: "phone deve conter 10 ou 11 dígitos numéricos (DDD + número)",
  })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
