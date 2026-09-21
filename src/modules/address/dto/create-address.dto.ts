import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from "class-validator";
import { AddressType } from "../../../../generated/prisma/enums";
import { OwnerDto } from "../../../common/dto/owner.dto";

export class CreateAddressDto extends OwnerDto {
  @IsEnum(AddressType)
  type!: AddressType;

  @Matches(/^\d{8}$/, {
    message: "cep deve conter 8 dígitos numéricos, sem máscara",
  })
  cep!: string;

  @IsString()
  @IsNotEmpty()
  publicPlace!: string;

  @IsString()
  @IsNotEmpty()
  number!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  complement?: string;

  @IsUUID()
  cityId!: string;
}
