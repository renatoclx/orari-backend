import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsUUID,
  Min,
  ValidateNested,
} from "class-validator";

/** Um produto da venda: quantas unidades e o valor cobrado por unidade. */
export class ProductSaleItemDto {
  @IsUUID(undefined, { message: "Produto inválido" })
  productId!: string;

  @Type(() => Number)
  @IsInt({ message: "Informe a quantidade em número inteiro" })
  @Min(1, { message: "A quantidade precisa ser 1 ou mais" })
  quantity!: number;

  /** Sugerido pela tela (promocional ou de venda), mas pode mudar. */
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: "Informe o valor com até duas casas decimais" },
  )
  @Min(0.01, { message: "O valor precisa ser maior que zero" })
  unitPrice!: number;
}

// Venda na comanda: a empresa vem do usuário (só o ADMIN vende).
export class CreateProductSaleDto {
  @IsUUID(undefined, { message: "Cliente inválido" })
  clientId!: string;

  @IsArray()
  @ArrayMinSize(1, { message: "Adicione ao menos um produto" })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProductSaleItemDto)
  items!: ProductSaleItemDto[];
}
