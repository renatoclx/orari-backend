import { IsOptional, Matches } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

// Período em dias do relógio da empresa (AAAA-MM-DD), pontas incluídas; sem
// período, o mês atual.
export class ClientsReportQueryDto {
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

// Aniversariantes: o mesmo período, paginado.
export class ClientsBirthdaysQueryDto extends PaginationQueryDto {
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
