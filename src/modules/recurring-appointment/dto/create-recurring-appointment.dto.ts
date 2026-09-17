import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { RecurringDayDto } from "./recurring-day.dto";

// A empresa vem do usuário autenticado.
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

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  note?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Sem dias, a recorrência não reserva horário nenhum.
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecurringDayDto)
  days!: RecurringDayDto[];
}
