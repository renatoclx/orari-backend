import { ApiProperty } from "@nestjs/swagger";
import { AppointmentStatus } from "../../../../generated/prisma/enums";

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
  /** Preenchido quando o agendamento veio de uma recorrência. */
  recurringAppointmentId!: string | null;
  createdAt!: Date;
  updatedAt!: Date | null;
  /** Mesmo que a pessoa tenha sido excluída depois, o nome continua aqui. */
  client!: AppointmentPersonDto;
  professional!: AppointmentPersonDto;
  /** Mesmo que o serviço tenha sido excluído depois, o nome continua aqui. */
  service!: AppointmentServiceDto;
}

export class AppointmentPageDto {
  items!: AppointmentResponseDto[];
  total!: number;
  page!: number;
  limit!: number;
}
