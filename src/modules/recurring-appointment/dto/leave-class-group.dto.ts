import { IsNotEmpty, IsOptional, IsString } from "class-validator";

// Saída da turma: o aluno da recorrência (avulsa ou de plano) deixa a turma fixa.
export class LeaveClassGroupDto {
  /** Motivo da saída, para quem consulta depois. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  note?: string;
}
