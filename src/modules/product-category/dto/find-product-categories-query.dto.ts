import { Transform } from "class-transformer";
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export class FindProductCategoriesQueryDto extends PaginationQueryDto {
  /** Busca parcial, sem diferenciar acentos nem maiúsculas. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  /** Sem o filtro, vêm ativas e inativas; `true` traz só as ativas (ex.: escolher a categoria de um produto). */
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
