import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsUUID, ValidateNested } from "class-validator";
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
}
