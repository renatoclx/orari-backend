import { IsOptional, IsUUID } from "class-validator";
import { PaginationQueryDto } from "./pagination-query.dto";

// Filtros das listagens de registros que pertencem a uma empresa ou a uma pessoa.
export class FindOwnedQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  peopleId?: string;
}
