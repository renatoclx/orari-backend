import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

// Clientes com pagamento atrasado: é a situação de hoje, sem período.
export class ReceivablesDebtorsQueryDto {
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
