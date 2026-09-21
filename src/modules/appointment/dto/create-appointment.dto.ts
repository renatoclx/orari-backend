import { Type } from "class-transformer";
import {
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
}
