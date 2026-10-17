import { Transform } from "class-transformer";
import { IsOptional, IsString, MaxLength } from "class-validator";

// Edição feita pelo administrador da própria empresa: só o nome fantasia. Os
// demais dados cadastrais continuam exclusivos do SUPER_ADMIN (UpdateCompanyDto).
export class UpdateOwnCompanyDto {
  /**
   * Nome fantasia, até 100 caracteres. Texto vazio ou nulo remove o nome
   * fantasia: a razão social passa a ser o nome exibido. Sem o campo, nada muda.
   */
  @IsOptional()
  // Espaços nas pontas não contam, e texto vazio vira null (remover o nome).
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  })
  @IsString()
  @MaxLength(100)
  fantasyName?: string | null;
}
