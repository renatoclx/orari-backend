import { IsOptional, IsUUID, Matches } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

// Período em dias do relógio da empresa (AAAA-MM-DD), pontas incluídas, pela
// data do pagamento; sem período, o mês atual. Método opcional.
export class FinancialReportQueryDto {
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

  @IsOptional()
  @IsUUID(undefined, { message: "Método de pagamento inválido" })
  paymentMethodId?: string;
}

// Extrato: os mesmos filtros, paginado.
export class FinancialReportPaymentsQueryDto extends PaginationQueryDto {
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

  @IsOptional()
  @IsUUID(undefined, { message: "Método de pagamento inválido" })
  paymentMethodId?: string;
}
