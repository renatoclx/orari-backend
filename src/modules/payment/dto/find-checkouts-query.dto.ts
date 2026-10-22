import { IsNotEmpty, IsOptional, IsString } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

// Comandas do dia: a paginação é por cliente.
export class FindCheckoutsQueryDto extends PaginationQueryDto {
  /** Parte do nome do cliente, sem diferenciar acentos nem maiúsculas. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  search?: string;
}
