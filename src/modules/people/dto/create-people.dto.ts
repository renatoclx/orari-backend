import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { PeopleType } from "../../../../generated/prisma/enums";
import { IsCpf } from "../../../common/validators/document.validator";
import {
  PHONE_MESSAGE,
  PHONE_PATTERN,
} from "../../contact/dto/create-contact.dto";
import { PeopleAddressDto } from "./people-address.dto";
import { PeopleContactDto } from "./people-contact.dto";

// Tamanho máximo da observação e das listas enviadas junto com a pessoa.
export const NOTE_MAX_LENGTH = 1000;
const MAX_ITEMS = 10;

// A empresa não é informada: a pessoa pertence à empresa do usuário autenticado.
export class CreatePeopleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** CPF sem máscara. Opcional; quando informado, precisa ser válido e único na empresa. */
  @IsOptional()
  @IsCpf()
  document?: string;

  /** Opcional. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  birthDate?: Date;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  profession?: string;

  @IsEnum(PeopleType)
  type!: PeopleType;

  /** Observação livre, até 1000 caracteres. */
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  note?: string;

  /**
   * Telefone principal (DDD + número, só dígitos). Gravado como o contato
   * principal da pessoa, separado da lista `contacts`. Opcional na API.
   */
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string;

  /**
   * Contatos adicionais, criados junto com a pessoa. Nenhum deles pode ser
   * principal quando `phone` é informado.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => PeopleContactDto)
  contacts?: PeopleContactDto[];

  /** Endereços, criados junto com a pessoa. No máximo um principal. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => PeopleAddressDto)
  addresses?: PeopleAddressDto[];
}
