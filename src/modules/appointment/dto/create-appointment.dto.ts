import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";

// A empresa vem do usuário autenticado. O fim (endAt) é calculado pela duração
// do serviço, por isso não é aceito no payload.
export class CreateAppointmentDto {
  @IsUUID()
  clientId!: string;

  @IsUUID()
  professionalId!: string;

  @IsUUID()
  serviceId!: string;

  @Type(() => Date)
  @IsDate()
  startAt!: Date;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  note?: string;

  /**
   * Autoriza o encaixe: marcar fora do horário de funcionamento (inclusive em
   * dia fechado). Sem ele, esse horário é recusado. O valor gravado é o real:
   * fica false se o horário estiver dentro do funcionamento.
   */
  @IsOptional()
  @IsBoolean()
  overBooking?: boolean;
}
