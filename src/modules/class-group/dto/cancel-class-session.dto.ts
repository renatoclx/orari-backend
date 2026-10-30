import { IsNotEmpty, IsOptional, IsString } from "class-validator";

// Cancelamento da sessão inteira pela clínica.
export class CancelClassSessionDto {
  /** Motivo, para quem consulta depois (ex.: "Feriado", "Professora ausente"). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  note?: string;
}
