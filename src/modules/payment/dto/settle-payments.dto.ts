import { Type } from "class-transformer";
import { IsDate, IsOptional, IsUUID } from "class-validator";

// Baixa em lote dos pagamentos pendentes de uma recorrência.
export class SettlePaymentsDto {
  @IsUUID()
  paymentMethodId!: string;

  /** Quando não informada, a baixa usa o momento da requisição. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  paidAt?: Date;
}
