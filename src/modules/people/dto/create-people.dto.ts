import { Type } from "class-transformer";
import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from "class-validator";
import { PeopleType } from "../../../../generated/prisma/enums";
import { IsCpf } from "../../../common/validators/document.validator";

// A empresa não é informada: a pessoa pertence à empresa do usuário autenticado.
export class CreatePeopleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsCpf()
  document!: string;

  @Type(() => Date)
  @IsDate()
  birthDate!: Date;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  profession?: string;

  @IsEnum(PeopleType)
  type!: PeopleType;
}
