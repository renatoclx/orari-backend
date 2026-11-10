import { IsOptional, Matches } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

// Período em dias do relógio da empresa (AAAA-MM-DD), pontas incluídas; sem
// período, o mês atual. Vale para as contratações novas e as canceladas.
export class PackagesReportQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Informe a data inicial no formato AAAA-MM-DD",
  })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Informe a data final no formato AAAA-MM-DD",
  })
  to?: string;
}

// Terminando em breve: é a situação de hoje, sem período.
export class PackagesEndingQueryDto extends PaginationQueryDto {}
