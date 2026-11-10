import { IsIn, IsOptional, Matches } from "class-validator";

export const RANKING_SORTS = ["amount", "count"] as const;
export type RankingSort = (typeof RANKING_SORTS)[number];

// Período em dias do relógio da empresa (AAAA-MM-DD), pontas incluídas; sem
// período, o mês atual. Ordem: faturado (padrão) ou quantidade.
export class RankingsQueryDto {
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
  @IsIn(RANKING_SORTS, { message: "Ordem inválida" })
  sort?: RankingSort;
}
