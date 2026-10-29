import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { RecurringDayDto } from "../../recurring-appointment/dto/recurring-day.dto";

// Agenda de um serviço do plano: quem atende e em quais dias e horários.
export class ClientPlanScheduleDto {
  @IsUUID()
  serviceId!: string;

  @IsUUID()
  professionalId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecurringDayDto)
  days!: RecurringDayDto[];

  /**
   * Encaixa este serviço numa turma fixa: serviço e profissional precisam ser
   * os da turma, e os dias, horários dela (ver docs/turmas.md).
   */
  @IsOptional()
  @IsUUID()
  classGroupId?: string;
}
