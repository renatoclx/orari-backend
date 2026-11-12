import { IsOptional, Matches } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

// Mês das comissões, pela data do atendimento, no relógio da empresa
// (AAAA-MM). Sem ele, o mês atual.
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class ProfessionalCommissionSummaryQueryDto {
  @IsOptional()
  @Matches(MONTH, { message: "Informe o mês no formato AAAA-MM" })
  month?: string;
}

// A lista do mês: 10 por página, como a de clientes.
export class ProfessionalCommissionListQueryDto extends PaginationQueryDto {
  override limit: number = 10;

  @IsOptional()
  @Matches(MONTH, { message: "Informe o mês no formato AAAA-MM" })
  month?: string;
}

// Fechamentos: 10 por página, do número maior para o menor.
export class ProfessionalClosingListQueryDto extends PaginationQueryDto {
  override limit: number = 10;
}
