import { Type } from "class-transformer";
import { IsDate, IsOptional, IsUUID } from "class-validator";

// Resumo da tela de Pagamentos: só o cliente e o período de vencimento filtram
// (mesmos tipos da listagem); status e os demais filtros não se aplicam.
export class SummaryPaymentsQueryDto {
  /** Pagamentos do cliente, venham de agendamento ou de contratação de plano. */
  @IsOptional()
  @IsUUID()
  clientId?: string;

  /** Início do período de vencimento, incluído. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueFrom?: Date;

  /** Fim do período de vencimento, incluído. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueTo?: Date;
}
