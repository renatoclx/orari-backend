import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { ClientPortfolioQueryDto } from "./client-portfolio-query.dto";

export const PORTFOLIO_STATUSES = ["NEW", "ACTIVE", "LAPSED"] as const;
export type PortfolioStatus = (typeof PORTFOLIO_STATUSES)[number];

// Mesmos filtros do resumo, mais situação, busca e página.
export class ClientPortfolioClientsQueryDto extends ClientPortfolioQueryDto {
  /** Situação na carteira; sem ela, todos. */
  @IsOptional()
  @IsIn(PORTFOLIO_STATUSES, { message: "Situação inválida" })
  status?: PortfolioStatus;

  /** Parte do nome do cliente (sem diferenciar acentos e caixa). */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}
