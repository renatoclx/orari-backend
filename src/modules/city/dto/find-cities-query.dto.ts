import { IsNotEmpty, IsOptional, IsString, IsUUID } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export class FindCitiesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  stateId?: string;

  // Busca parcial, sem diferenciar acentos nem maiúsculas.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;
}
