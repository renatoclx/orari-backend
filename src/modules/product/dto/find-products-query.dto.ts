import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export class FindProductsQueryDto extends PaginationQueryDto {
  /** Busca parcial pelo nome ou pelo SKU, sem diferenciar acentos nem maiúsculas. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  search?: string;

  @IsOptional()
  @IsUUID("all")
  categoryId?: string;

  @IsOptional()
  @IsUUID("all")
  supplierId?: string;

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
