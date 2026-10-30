import { ApiProperty } from "@nestjs/swagger";
import {
  AppointmentCancelReason,
  AppointmentStatus,
} from "../../../../generated/prisma/enums";

/**
 * Formatos de resposta, só para documentar a API (Swagger). O service devolve
 * o resultado do Prisma, que tem a mesma forma.
 */
export class AppointmentPersonDto {
  id!: string;
  name!: string;
  /** Caminho da foto (ex.: /uploads/people/<arquivo>.jpg), ou nulo. */
  photoUrl!: string | null;
}

export class AppointmentServiceDto {
  id!: string;
  name!: string;
  /** Cor hexadecimal do serviço, ou nulo. */
  color!: string | null;
  /** Duração em minutos. */
  duration!: number;
}

/** Recorrência de origem: `clientPlanId` preenchido quando ela é de um pacote. */
export class AppointmentOriginDto {
  id!: string;
  clientPlanId!: string | null;
}

export class AppointmentResponseDto {
  id!: string;
  companyId!: string;
  clientId!: string;
  professionalId!: string;
  serviceId!: string;
  startAt!: Date;
  endAt!: Date;
  note!: string | null;
  @ApiProperty({ enum: AppointmentStatus, enumName: "AppointmentStatus" })
  status!: AppointmentStatus;
  /** Encaixe: marcado fora do horário de funcionamento da empresa. */
  overBooking!: boolean;
  /** Preenchido quando o agendamento veio de uma recorrência. */
  recurringAppointmentId!: string | null;
  /** Preenchido quando o agendamento é de um aluno numa sessão de turma. */
  classSessionId!: string | null;
  /** Cancelamento pela clínica na turma (sessão cancelada ou saída); permite repor a sessão de plano. */
  @ApiProperty({
    enum: AppointmentCancelReason,
    enumName: "AppointmentCancelReason",
    nullable: true,
  })
  cancelReason!: AppointmentCancelReason | null;
  createdAt!: Date;
  updatedAt!: Date | null;
  /** Mesmo que a pessoa tenha sido excluída depois, o nome continua aqui. */
  client!: AppointmentPersonDto;
  professional!: AppointmentPersonDto;
  /** Mesmo que o serviço tenha sido excluído depois, o nome continua aqui. */
  service!: AppointmentServiceDto;
  /** Nulo no agendamento avulso. */
  recurringAppointment!: AppointmentOriginDto | null;
}

export class AppointmentPageDto {
  items!: AppointmentResponseDto[];
  total!: number;
  page!: number;
  limit!: number;
}
