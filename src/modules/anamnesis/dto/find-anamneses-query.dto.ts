import { IsUUID } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export class FindAnamnesesQueryDto extends PaginationQueryDto {
  /** Cliente cujas fichas são listadas (obrigatório: não há listagem geral). */
  @IsUUID("all")
  clientId!: string;
}
