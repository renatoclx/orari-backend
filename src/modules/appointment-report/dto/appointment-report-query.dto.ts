import { IsOptional, IsUUID, Matches } from "class-validator";

// Período em dias do relógio da empresa (AAAA-MM-DD), pontas incluídas; sem
// período, o mês atual. Sem profissional, a empresa toda.
export class AppointmentReportQueryDto {
  @IsOptional()
  @IsUUID()
  professionalId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Informe a data inicial no formato AAAA-MM-DD",
  })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Informe a data final no formato AAAA-MM-DD",
  })
  to?: string;
}
