import { IsNotEmpty, IsOptional, IsString } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export class FindPaymentMethodsQueryDto extends PaginationQueryDto {
  // Busca parcial, sem diferenciar acentos nem maiúsculas.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;
}
