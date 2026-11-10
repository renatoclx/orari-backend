import { IsOptional, IsUUID, Matches } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

// Período em dias do relógio da empresa (AAAA-MM-DD), pontas incluídas, pela
// data do atendimento; sem período, o mês atual. Profissional opcional.
export class CommissionSummaryQueryDto {
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
  @IsUUID(undefined, { message: "Profissional inválido" })
  professionalId?: string;
}

// Atendimento a atendimento: os mesmos filtros, paginado.
export class CommissionListQueryDto extends PaginationQueryDto {
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
  @IsUUID(undefined, { message: "Profissional inválido" })
  professionalId?: string;
}
