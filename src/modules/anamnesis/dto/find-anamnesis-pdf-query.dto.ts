import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";

export class FindAnamnesisPdfQueryDto {
  /**
   * Imprime também o histórico de acompanhamento (padrão: sim). O histórico é
   * controle do profissional; sem ele sai só a ficha para o cliente assinar.
   */
  // Query string chega como texto; @Type(() => Boolean) converteria "false" em true.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  @IsBoolean()
  includeHistory: boolean = true;
}
