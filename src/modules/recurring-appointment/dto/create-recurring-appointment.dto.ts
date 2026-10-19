import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { RecurringDayDto } from "./recurring-day.dto";

// A empresa vem do usuário autenticado. A recorrência sempre nasce ativa.
export class CreateRecurringAppointmentDto {
  @IsUUID()
  clientId!: string;

  @IsUUID()
  professionalId!: string;

  @IsUUID()
  serviceId!: string;

  @Type(() => Date)
  @IsDate()
  startDate!: Date;

  /** Obrigatória, sem limite de duração (ex.: um ano); não pode vir antes de startDate. */
  @Type(() => Date)
  @IsDate()
  endDate!: Date;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  note?: string;

  /** Sem dias, a recorrência não reserva horário nenhum. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecurringDayDto)
  days!: RecurringDayDto[];
}
