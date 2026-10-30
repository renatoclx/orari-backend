import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";
import { CLASS_GROUP_CAPACITY_MAX } from "./create-class-group.dto";

// Encaixe de um ou mais clientes numa sessão existente (fixa ou avulsa), tudo ou nada.
export class EnrollClassSessionParticipantDto {
  /** Pessoas do tipo CLIENT da empresa, sem repetidas (até o máximo de vagas). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CLASS_GROUP_CAPACITY_MAX)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  clientIds!: string[];

  /** Observação do agendamento de cada aluno encaixado. */
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
