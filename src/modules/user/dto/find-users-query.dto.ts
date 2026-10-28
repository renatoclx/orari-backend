import { IsNotEmpty, IsOptional, IsString, IsUUID } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export class FindUsersQueryDto extends PaginationQueryDto {
  /**
   * Filtro disponível ao SUPER_ADMIN; para ADMIN, só a própria empresa é
   * aceita.
   */
  @IsOptional()
  @IsUUID()
  companyId?: string;

  /** Busca parcial pelo nome, sem diferenciar maiúsculas (acentos contam). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;
}
