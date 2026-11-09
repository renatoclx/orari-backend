import { IsOptional, IsUUID, Matches } from "class-validator";

// Profissional e período em dias do relógio da empresa (AAAA-MM-DD), com as
// duas pontas incluídas. Sem período, o mês atual.
export class ClientPortfolioQueryDto {
  @IsUUID()
  professionalId!: string;

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
