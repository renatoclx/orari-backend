import { ArrayUnique, IsArray, IsOptional, IsUUID } from "class-validator";
import { SettlePaymentsDto } from "./settle-payments.dto";

// Baixa dos itens escolhidos de uma comanda: método e data valem para todos.
// Ao menos um item, somando as duas listas (conferido no serviço).
export class SettleCheckoutDto extends SettlePaymentsDto {
  /** Pagamentos pendentes de um mesmo cliente, sem repetir. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID("all", { each: true })
  paymentIds?: string[];

  /**
   * Atendimentos avulsos ainda sem pagamento (recebidos antes da conclusão):
   * cada um ganha um pagamento já pago, com o preço do serviço.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID("all", { each: true })
  appointmentIds?: string[];
}
