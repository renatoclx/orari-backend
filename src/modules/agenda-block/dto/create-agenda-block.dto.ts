import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, Matches } from "class-validator";
import { TIME_OF_DAY_PATTERN } from "../../../common/time/time-of-day";

export class CreateAgendaBlockDto {
  /** Dia no relógio da empresa (AAAA-MM-DD). */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Informe a data no formato AAAA-MM-DD",
  })
  date!: string;

  /** Início do bloqueio (HH:MM, no relógio da empresa). */
  @Matches(TIME_OF_DAY_PATTERN, {
    message: "Informe o início no formato HH:MM",
  })
  startTime!: string;

  /** Fim do bloqueio (HH:MM, no relógio da empresa). */
  @Matches(TIME_OF_DAY_PATTERN, { message: "Informe o fim no formato HH:MM" })
  endTime!: string;

  // Já há agendamentos no horário: a clínica confirmou que bloqueia mesmo
  // assim (eles continuam marcados). Sem isso, a API responde 409 com a contagem.
  @ApiPropertyOptional({
    description:
      "true: bloqueia mesmo com agendamentos no horário (eles continuam marcados).",
  })
  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;
}
