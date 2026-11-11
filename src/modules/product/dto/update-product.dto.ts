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
  ValidateIf,
} from "class-validator";
import { ProductUnit } from "../../../../generated/prisma/enums";

const PRICE = { maxDecimalPlaces: 2 } as const;
const MIN_PRICE = 0.01;

// Ausente: não muda. null: recusado nos campos obrigatórios (só pula o que não veio).
const IfPresent = () => ValidateIf((_, value) => value !== undefined);
// Campo opcional: null remove o valor gravado.
const IfNotNull = () => ValidateIf((_, value) => value !== null);

/** Tudo é opcional; o que não for enviado vem do que está gravado. */
export class UpdateProductDto {
  @IfPresent()
  @IsString()
  @IsNotEmpty()
  name?: string;

  /** `null` remove. */
  @IsOptional()
  @IfNotNull()
  @IsString()
  @IsNotEmpty()
  description?: string | null;

  /** `null` remove. */
  @IsOptional()
  @IfNotNull()
  @IsString()
  @IsNotEmpty()
  sku?: string | null;

  /** Categoria ativa da empresa. */
  @IfPresent()
  @IsUUID("all")
  categoryId?: string;

  /** `null` remove o fornecedor. */
  @IsOptional()
  @IfNotNull()
  @IsUUID("all")
  supplierId?: string | null;

  /** `null` remove. */
  @IsOptional()
  @IfNotNull()
  @IsEnum(ProductUnit, { message: "Unidade de medida inválida" })
  measureUnit?: ProductUnit | null;

  @IfPresent()
  @Type(() => Number)
  @IsNumber(PRICE)
  @Min(MIN_PRICE)
  salePrice?: number;

  @IfPresent()
  @Type(() => Number)
  @IsNumber(PRICE)
  @Min(MIN_PRICE)
  purchasePrice?: number;

  /** `null` remove o preço promocional. */
  @IsOptional()
  @IfNotNull()
  @Type(() => Number)
  @IsNumber(PRICE)
  @Min(MIN_PRICE)
  promotionalPrice?: number | null;

  @IfPresent()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  currentStock?: number;

  /** `null` remove. */
  @IsOptional()
  @IfNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minimalStock?: number | null;

  /** `null` remove. */
  @IsOptional()
  @IfNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maximumStock?: number | null;

  /** Reativar exige a categoria ativa. */
  @IfPresent()
  @IsBoolean()
  isActive?: boolean;
}
