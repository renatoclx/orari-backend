import {
  AppointmentPersonDto,
  AppointmentServiceDto,
} from "../../appointment/dto/appointment-response.dto";
import { RecurringDayDto } from "./recurring-day.dto";

/**
 * Formatos de resposta, só para documentar a API (Swagger). O service devolve
 * o resultado do Prisma, que tem a mesma forma.
 */
export class RecurringAppointmentResponseDto {
  id!: string;
  companyId!: string;
  clientId!: string;
  professionalId!: string;
  serviceId!: string;
  startDate!: Date;
  endDate!: Date | null;
  note!: string | null;
  isActive!: boolean;
  /** Preenchido quando a recorrência é a agenda de um serviço de um pacote. */
  clientPlanId!: string | null;
  /** Turma fixa em que a recorrência está encaixada. */
  classGroupId!: string | null;
  /** Saída da turma: quando o aluno saiu (nulo enquanto está nela). */
  classLeftAt!: Date | null;
  /** Motivo da saída da turma. */
  classLeaveNote!: string | null;
  createdAt!: Date;
  updatedAt!: Date | null;
  days!: RecurringDayDto[];
  /** Mesmo que a pessoa tenha sido excluída depois, o nome continua aqui. */
  client!: AppointmentPersonDto;
  professional!: AppointmentPersonDto;
  /** Mesmo que o serviço tenha sido excluído depois, o nome continua aqui. */
  service!: AppointmentServiceDto;
}

export class RecurringAppointmentPageDto {
  items!: RecurringAppointmentResponseDto[];
  total!: number;
  page!: number;
  limit!: number;
}
