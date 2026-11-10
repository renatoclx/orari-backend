import { Type } from "class-transformer";
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from "class-validator";

// Adiantamento de comissão: abatido no fechamento.
export class CreateCommissionAdvanceDto {
  @IsUUID(undefined, { message: "Profissional inválido" })
  professionalId!: string;

  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: "Informe o valor com até duas casas decimais" },
  )
  @Min(0.01, { message: "O valor precisa ser maior que zero" })
  amount!: number;

  /** AAAA-MM-DD, no calendário da empresa; pode ser passada, nunca futura. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Informe a data no formato AAAA-MM-DD",
  })
  date!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  note?: string;
}

// Adiantamentos de um profissional (ou o disponível para adiantar).
export class CommissionAdvanceQueryDto {
  @IsUUID(undefined, { message: "Profissional inválido" })
  professionalId!: string;
}

// Listagem: os do período (AAAA-MM-DD, pontas incluídas; padrão: mês atual),
// em aberto ou fechados, mais os em aberto de qualquer data.
export class CommissionAdvanceListQueryDto extends CommissionAdvanceQueryDto {
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
