import { PartialType } from "@nestjs/mapped-types";
import { CreateRecurringAppointmentDto } from "./create-recurring-appointment.dto";

// Quando `days` é informado, a lista substitui inteiramente os dias atuais.
export class UpdateRecurringAppointmentDto extends PartialType(
  CreateRecurringAppointmentDto,
) {}
