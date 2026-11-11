import { Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from "class-validator";
import { ProductUnit } from "../../../../generated/prisma/enums";

// Preços em reais, com até duas casas, maiores que zero.
const PRICE = { maxDecimalPlaces: 2 } as const;
const MIN_PRICE = 0.01;

/**
 * A empresa não é informada: o produto pertence à empresa do usuário
 * autenticado. A margem de lucro não entra: é calculada pela API.
 */
export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  /** Código interno; único entre os produtos não excluídos da empresa. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  sku?: string;

  /** Categoria ativa da empresa. */
  @IsUUID("all")
  categoryId!: string;

  /** Pessoa ativa da empresa do tipo SUPPLIER. */
  @IsOptional()
  @IsUUID("all")
  supplierId?: string;

  @IsOptional()
  @IsEnum(ProductUnit, { message: "Unidade de medida inválida" })
  measureUnit?: ProductUnit;

  @Type(() => Number)
  @IsNumber(PRICE)
  @Min(MIN_PRICE)
  salePrice!: number;

  @Type(() => Number)
  @IsNumber(PRICE)
  @Min(MIN_PRICE)
  purchasePrice!: number;

  /** Menor que o preço de venda. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber(PRICE)
  @Min(MIN_PRICE)
  promotionalPrice?: number;

  /** Saldo inicial, inteiro; vira a primeira movimentação de estoque. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  currentStock!: number;

  /** Não pode passar do estoque máximo. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minimalStock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maximumStock?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
