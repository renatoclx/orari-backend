import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from "class-validator";
import { SettlePaymentsDto } from "./settle-payments.dto";

// Baixa dos pagamentos escolhidos de uma comanda: método e data valem para todos.
export class SettleCheckoutDto extends SettlePaymentsDto {
  /** Pagamentos pendentes de um mesmo cliente, sem repetir. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  paymentIds!: string[];
}
