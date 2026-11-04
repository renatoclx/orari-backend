import { IsUUID, Matches } from "class-validator";

export class FindAvailabilityQueryDto {
  @IsUUID()
  serviceId!: string;

  @IsUUID()
  professionalId!: string;

  /** Dia no relógio da clínica (AAAA-MM-DD). */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Informe a data no formato AAAA-MM-DD",
  })
  date!: string;
}
