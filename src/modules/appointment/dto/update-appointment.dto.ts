import { PartialType } from "@nestjs/mapped-types";
import { IsEnum, IsOptional } from "class-validator";
import { AppointmentStatus } from "../../../../generated/prisma/enums";
import { CreateAppointmentDto } from "./create-appointment.dto";

// O status só muda pela edição: não há exclusão de agendamento (ver domain.md).
export class UpdateAppointmentDto extends PartialType(CreateAppointmentDto) {
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;
}
