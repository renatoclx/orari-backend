import { IsString, MaxLength } from "class-validator";

/** Entrada do profissional no app: telefone e senha, como o cliente. */
export class ProfessionalLoginDto {
  /** Telefone com DDD (máscara e +55 são aceitos). */
  @IsString()
  @MaxLength(30)
  phone!: string;

  // Sem regra de tamanho mínimo: o login só confere, não cadastra.
  @IsString()
  @MaxLength(72)
  password!: string;
}
