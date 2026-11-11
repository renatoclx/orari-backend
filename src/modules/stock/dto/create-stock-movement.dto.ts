import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { StockMovementType } from "../../../../generated/prisma/enums";
import { PayablePaidDto } from "../../payable/dto/create-payable.dto";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Tipos lançados à mão (o saldo inicial vem do cadastro do produto). */
export const MANUAL_TYPES = [
  StockMovementType.PURCHASE,
  StockMovementType.INTERNAL_USE,
  StockMovementType.LOSS,
  StockMovementType.ADJUSTMENT,
] as const;
export type ManualMovementType = (typeof MANUAL_TYPES)[number];

/**
 * Conta a pagar da compra (opcional). O valor é quantidade × custo; sem
 * `payeeId`, o favorecido é o fornecedor do produto (`null`: nenhum).
 */
export class StockPurchasePayableDto {
  @IsOptional()
  @IsUUID(undefined, { message: "Favorecido inválido" })
  payeeId?: string | null;

  @IsUUID(undefined, { message: "Categoria inválida" })
  categoryId!: string;

  @Matches(DATE, { message: "Informe o vencimento no formato AAAA-MM-DD" })
  dueDate!: string;

  /** A conta já nasce paga (data até hoje e método). */
  @IsOptional()
  @ValidateNested()
  @Type(() => PayablePaidDto)
  paid?: PayablePaidDto;
}

export class CreateStockMovementDto {
  @IsIn(MANUAL_TYPES, { message: "Tipo de movimentação inválido" })
  type!: ManualMovementType;

  /**
   * Entrada e saídas: quantas unidades (1 ou mais). Ajuste: o saldo contado
   * (0 ou mais), que passa a ser o estoque.
   */
  @Type(() => Number)
  @IsInt({ message: "Informe a quantidade em número inteiro" })
  @Min(0, { message: "A quantidade não pode ser negativa" })
  quantity!: number;

  /** Só na entrada por compra, e obrigatório nela. */
  @ValidateIf(
    (dto: CreateStockMovementDto) =>
      dto.type === StockMovementType.PURCHASE || dto.unitCost !== undefined,
  )
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: "Informe o custo com até duas casas decimais" },
  )
  @Min(0.01, { message: "O custo precisa ser maior que zero" })
  unitCost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Só na entrada por compra. */
  @IsOptional()
  @ValidateNested()
  @Type(() => StockPurchasePayableDto)
  payable?: StockPurchasePayableDto;
}
