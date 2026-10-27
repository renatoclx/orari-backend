import { IsNotEmpty, IsOptional, IsString } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export class FindAnamnesisClientsQueryDto extends PaginationQueryDto {
  /** Busca parcial pelo nome do cliente, sem diferenciar acentos nem maiúsculas. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;
}
