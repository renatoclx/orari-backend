import { Type } from "class-transformer";
import { IsInt, IsUUID, Max, Min } from "class-validator";
import {
  CLASS_GROUP_CAPACITY_MAX,
  CLASS_GROUP_CAPACITY_MIN,
} from "./create-class-group.dto";

// Agendamento que vira turma: a sessão copia o horário, o serviço e o profissional dele.
export class CreateClassSessionDto {
  @IsUUID("all")
  appointmentId!: string;

  /** Quantidade máxima de alunos, contando o do agendamento original. */
  @Type(() => Number)
  @IsInt()
  @Min(CLASS_GROUP_CAPACITY_MIN)
  @Max(CLASS_GROUP_CAPACITY_MAX)
  capacity!: number;
}

export class UpdateClassSessionDto {
  /** Não pode ficar abaixo do número de alunos da sessão. */
  @Type(() => Number)
  @IsInt()
  @Min(CLASS_GROUP_CAPACITY_MIN)
  @Max(CLASS_GROUP_CAPACITY_MAX)
  capacity!: number;
}
