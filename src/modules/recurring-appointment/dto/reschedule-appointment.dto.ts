import { Type } from "class-transformer";
import { IsDate } from "class-validator";

// Remanejamento: só o início muda; o fim vem da duração do serviço.
export class RescheduleAppointmentDto {
  @Type(() => Date)
  @IsDate()
  startAt!: Date;
}
