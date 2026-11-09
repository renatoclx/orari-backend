import { IsOptional, Matches } from "class-validator";

// Período em dias do relógio da empresa (AAAA-MM-DD), com as duas pontas
// incluídas. Sem período, o mês atual. Vale para o recebido e a inadimplência.
export class ReceivablesQueryDto {
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
