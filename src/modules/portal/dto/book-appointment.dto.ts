import { Type } from "class-transformer";
import { IsDate, IsUUID } from "class-validator";

export class BookAppointmentDto {
  @IsUUID()
  serviceId!: string;

  @IsUUID()
  professionalId!: string;

  /** Um dos horários de GET /portal/:slug/availability (`startAt`, em UTC). */
  @Type(() => Date)
  @IsDate()
  startAt!: Date;
}
