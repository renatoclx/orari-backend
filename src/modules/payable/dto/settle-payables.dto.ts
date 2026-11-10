import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
  Matches,
} from "class-validator";

// Pagar uma ou várias contas pendentes com a mesma data e o mesmo método.
export class SettlePayablesDto {
  @IsArray()
  @ArrayMinSize(1, { message: "Escolha ao menos uma conta" })
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  ids!: string[];

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Informe a data do pagamento no formato AAAA-MM-DD",
  })
  paidAt!: string;

  @IsUUID(undefined, { message: "Método de pagamento inválido" })
  paymentMethodId!: string;
}
