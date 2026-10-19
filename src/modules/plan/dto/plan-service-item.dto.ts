import { Type } from "class-transformer";
import { IsInt, IsUUID, Max, Min } from "class-validator";

// Serviço do plano e quantos atendimentos dele a semana prevê.
export class PlanServiceItemDto {
  @IsUUID("all")
  serviceId!: string;

  /** Atendimentos por semana (1 a 7). A contratação precisa agendar exatamente essa quantidade. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  sessionsPerWeek!: number;
}
