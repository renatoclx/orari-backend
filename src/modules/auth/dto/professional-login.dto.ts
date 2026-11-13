import { IsString, MaxLength } from "class-validator";

/** Entrada do profissional no app: telefone ou e-mail, e a senha. */
export class ProfessionalLoginDto {
  /** Telefone com DDD (máscara e +55 são aceitos) ou o e-mail do usuário. */
  @IsString()
  @MaxLength(254)
  login!: string;

  // Sem regra de tamanho mínimo: o login só confere, não cadastra.
  @IsString()
  @MaxLength(72)
  password!: string;
}
