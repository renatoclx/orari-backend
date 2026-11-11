import { IsIn, IsOptional, IsUUID, Matches } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export const PAYABLE_FILTERS = [
  "pending",
  "overdue",
  "upcoming",
  "paid",
  "cancelled",
  "all",
] as const;
export type PayableFilter = (typeof PAYABLE_FILTERS)[number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Filtros comuns ao resumo e à lista (vencimento com as pontas incluídas).
export class PayableSummaryQueryDto {
  @IsOptional()
  @IsUUID(undefined, { message: "Favorecido inválido" })
  payeeId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: "Categoria inválida" })
  categoryId?: string;

  @IsOptional()
  @Matches(DATE, { message: "Informe a data inicial no formato AAAA-MM-DD" })
  dueFrom?: string;

  @IsOptional()
  @Matches(DATE, { message: "Informe a data final no formato AAAA-MM-DD" })
  dueTo?: string;
}

export class PayableListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(PAYABLE_FILTERS, { message: "Situação inválida" })
  status?: PayableFilter;

  @IsOptional()
  @IsUUID(undefined, { message: "Favorecido inválido" })
  payeeId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: "Categoria inválida" })
  categoryId?: string;

  @IsOptional()
  @Matches(DATE, { message: "Informe a data inicial no formato AAAA-MM-DD" })
  dueFrom?: string;

  @IsOptional()
  @Matches(DATE, { message: "Informe a data final no formato AAAA-MM-DD" })
  dueTo?: string;
}

// Comissões em aberto: todas, ou só a do profissional (favorecido do filtro).
export class PayableCommissionQueryDto {
  @IsOptional()
  @IsUUID(undefined, { message: "Favorecido inválido" })
  payeeId?: string;
}
