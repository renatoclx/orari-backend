import { IsBoolean, IsNotEmpty, IsString, ValidateIf } from "class-validator";

// Só o nome e a situação mudam. Sem exclusão: a categoria é inativada e reativada aqui.
export class UpdateProductCategoryDto {
  // Ausente não muda; null é recusado (o nome é obrigatório).
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  name?: string;

  /** Inativar é recusado (409) enquanto a categoria tiver produtos ativos. */
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
