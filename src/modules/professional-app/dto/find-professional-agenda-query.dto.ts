import { IsOptional, Matches } from "class-validator";

// Dia da agenda, no relógio da empresa (AAAA-MM-DD). Sem ele, hoje.
export class FindProfessionalAgendaQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Informe o dia no formato AAAA-MM-DD",
  })
  day?: string;
}
