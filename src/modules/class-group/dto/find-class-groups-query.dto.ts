import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export class FindClassGroupsQueryDto extends PaginationQueryDto {
  /** Busca parcial pelo nome, sem diferenciar acentos nem maiúsculas. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  // Query string chega como texto; @Type(() => Boolean) converteria "false" em true.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsUUID("all")
  serviceId?: string;

  @IsOptional()
  @IsUUID("all")
  professionalId?: string;

  /** Cadastradas a partir deste dia (AAAA-MM-DD, no fuso da empresa), incluído. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  /** Cadastradas até este dia (AAAA-MM-DD, no fuso da empresa), incluído. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
