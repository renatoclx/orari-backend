import { Type } from "class-transformer";
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from "class-validator";
import { SubscriptionPaymentMethod } from "../../../../generated/prisma/enums";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Pagamento da assinatura lançado pelo SUPER_ADMIN (cobrança manual).
export class CreateSubscriptionPaymentDto {
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: "Informe o valor com até duas casas decimais" },
  )
  @Min(0.01, { message: "O valor precisa ser maior que zero" })
  amount!: number;

  @Matches(DATE, { message: "Informe a data do pagamento (AAAA-MM-DD)" })
  paidAt!: string;

  @IsIn(Object.values(SubscriptionPaymentMethod), {
    message: "Forma de pagamento inválida",
  })
  method!: SubscriptionPaymentMethod;

  /** Período coberto (inclusive). */
  @Matches(DATE, { message: "Informe o início do período (AAAA-MM-DD)" })
  periodStart!: string;

  @Matches(DATE, { message: "Informe o fim do período (AAAA-MM-DD)" })
  periodEnd!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

// Pagamentos de um mês, de todas as empresas (tela Cobranças).
export class SubscriptionPaymentQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: "Informe o mês (AAAA-MM)" })
  month?: string;
}
