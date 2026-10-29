import { Type } from "class-transformer";
import {
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";

// Encaixe de um cliente numa sessão existente (fixa ou avulsa).
export class EnrollClassSessionParticipantDto {
  /** Pessoa do tipo CLIENT da empresa. */
  @IsUUID("all")
  clientId!: string;

  /** Observação do agendamento do aluno. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  note?: string;
}

// Encaixe numa turma fixa: o horário escolhe a sessão (criada no primeiro encaixe).
export class EnrollClassGroupParticipantDto extends EnrollClassSessionParticipantDto {
  /** Início da sessão: precisa cair num dia e horário da turma, no fuso da empresa. */
  @Type(() => Date)
  @IsDate()
  startAt!: Date;
}
