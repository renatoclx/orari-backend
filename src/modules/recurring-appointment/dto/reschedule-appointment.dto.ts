import { Type } from "class-transformer";
import { IsDate, IsUUID } from "class-validator";

// Remanejamento: só o início muda; o fim vem da duração do serviço.
export class RescheduleAppointmentDto {
  @Type(() => Date)
  @IsDate()
  startAt!: Date;
}

// Reposição (ou remanejamento) numa sessão de turma fixa, da mesma ou de outra turma.
export class ReplaceInClassGroupDto extends RescheduleAppointmentDto {
  /** Turma do mesmo serviço da aula; o startAt precisa ser um horário dela. */
  @IsUUID("all")
  classGroupId!: string;
}
