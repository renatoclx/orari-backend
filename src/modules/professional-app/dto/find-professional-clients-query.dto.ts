import { IsOptional, IsString, MaxLength } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

// Lista de clientes do app: 20 por página (o celular rola pouco por vez).
export class FindProfessionalClientsQueryDto extends PaginationQueryDto {
  override limit: number = 20;

  /** Nome do cliente, sem diferenciar acento nem maiúsculas. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
