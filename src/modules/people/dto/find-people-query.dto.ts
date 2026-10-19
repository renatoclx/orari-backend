import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from "class-validator";
import { PeopleType } from "../../../../generated/prisma/enums";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export class FindPeopleQueryDto extends PaginationQueryDto {
  /** Busca parcial, sem diferenciar acentos nem maiúsculas. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  /** Busca exata pelo CPF (sem máscara). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  document?: string;

  @IsOptional()
  @IsEnum(PeopleType)
  type?: PeopleType;

  /**
   * Sem o filtro, vêm ativas e inativas (o status sai do deletedAt). `true` traz
   * só as ativas; `false`, só as inativas.
   */
  // Query string chega como texto; @Type(() => Boolean) converteria "false" em true.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;
}
