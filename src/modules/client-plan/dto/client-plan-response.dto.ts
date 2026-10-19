import { ApiProperty } from "@nestjs/swagger";
import { PlanBillingType } from "../../../../generated/prisma/enums";
import {
  AppointmentPersonDto,
  AppointmentServiceDto,
} from "../../appointment/dto/appointment-response.dto";
import { RecurringDayDto } from "../../recurring-appointment/dto/recurring-day.dto";

/**
 * Formatos de resposta, só para documentar a API (Swagger). O service devolve
 * o resultado do Prisma, que tem a mesma forma.
 */
export class ClientPlanSummaryDto {
  id!: string;
  /** Mesmo que o plano tenha sido inativado depois, o nome continua aqui. */
  name!: string;
}

/** A agenda de um serviço do plano (uma recorrência por serviço). */
export class ClientPlanScheduleResponseDto {
  id!: string;
  serviceId!: string;
  professionalId!: string;
  /** Falso quando a contratação foi cancelada. */
  isActive!: boolean;
  service!: AppointmentServiceDto;
  professional!: AppointmentPersonDto;
  /** Dias e horários reservados ("HH:MM"), da segunda ao domingo. */
  days!: RecurringDayDto[];
}

export class ClientPlanResponseDto {
  id!: string;
  companyId!: string;
  clientId!: string;
  planId!: string;
  @ApiProperty({ enum: PlanBillingType, enumName: "PlanBillingType" })
  billingType!: PlanBillingType;
  months!: number;
  startDate!: Date;
  endDate!: Date;
  /** Valores congelados na contratação, como texto decimal (ex.: "400"). */
  monthlyAmount!: string;
  discountPercent!: string;
  totalAmount!: string;
  firstDueDate!: Date | null;
  /** Preenchido quando a contratação foi cancelada. */
  cancelledAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date | null;
  /** Mesmo que a pessoa tenha sido excluída depois, o nome continua aqui. */
  client!: AppointmentPersonDto;
  plan!: ClientPlanSummaryDto;
  recurringAppointments!: ClientPlanScheduleResponseDto[];
}

export class ClientPlanPageDto {
  items!: ClientPlanResponseDto[];
  total!: number;
  page!: number;
  limit!: number;
}
