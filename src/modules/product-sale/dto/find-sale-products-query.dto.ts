import { IsNotEmpty, IsOptional, IsString } from "class-validator";

/** Busca de produtos para vender (nome ou SKU). */
export class FindSaleProductsQueryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  search?: string;
}
