import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Repetição: parcelar o valor em N vezes ou repetir o mesmo valor por N meses. */
export class PayableRepeatDto {
  @IsIn(["installments", "monthly"], { message: "Repetição inválida" })
  mode!: "installments" | "monthly";

  @Type(() => Number)
  @IsInt({ message: "Informe quantas vezes" })
  @Min(2, { message: "A repetição tem pelo menos 2 vezes" })
  @Max(60, { message: "A repetição tem no máximo 60 vezes" })
  count!: number;
}

/** "Já está paga": data (até hoje) e método do pagamento. */
export class PayablePaidDto {
  @Matches(DATE, {
    message: "Informe a data do pagamento no formato AAAA-MM-DD",
  })
  paidAt!: string;

  @IsUUID(undefined, { message: "Método de pagamento inválido" })
  paymentMethodId!: string;
}

// Conta a pagar: a empresa vem do usuário (só o ADMIN).
export class CreatePayableDto {
  @IsString()
  @IsNotEmpty({ message: "Informe a descrição" })
  @MaxLength(120)
  description!: string;

  /** Fornecedor ou profissional da empresa; opcional. */
  @IsOptional()
  @IsUUID(undefined, { message: "Favorecido inválido" })
  payeeId?: string | null;

  @IsUUID(undefined, { message: "Categoria inválida" })
  categoryId!: string;

  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: "Informe o valor com até duas casas decimais" },
  )
  @Min(0.01, { message: "O valor precisa ser maior que zero" })
  amount!: number;

  /** AAAA-MM-DD (o primeiro, na repetição). */
  @Matches(DATE, { message: "Informe o vencimento no formato AAAA-MM-DD" })
  dueDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => PayableRepeatDto)
  repeat?: PayableRepeatDto;

  /** Só sem repetição. */
  @IsOptional()
  @ValidateNested()
  @Type(() => PayablePaidDto)
  paid?: PayablePaidDto;
}
