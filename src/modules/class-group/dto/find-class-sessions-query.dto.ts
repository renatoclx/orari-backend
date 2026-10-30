import { Type } from "class-transformer";
import { IsDate, IsOptional, IsUUID } from "class-validator";

// Período máximo da agenda por sessão: a consulta não é paginada.
export const CLASS_SESSIONS_RANGE_MAX_DAYS = 31;

/**
 * Agenda por sessão (from <= startAt < to). As datas são instantes ISO 8601 em
 * UTC, como em GET /appointments: para o dia 15/10 em São Paulo, use
 * from=2026-10-15T03:00:00.000Z e to=2026-10-16T03:00:00.000Z.
 */
export class FindClassSessionsQueryDto {
  /** Início do período, incluído. */
  @Type(() => Date)
  @IsDate()
  from!: Date;

  /** Fim do período, excluído; no máximo 31 dias depois do início. */
  @Type(() => Date)
  @IsDate()
  to!: Date;

  @IsOptional()
  @IsUUID("all")
  professionalId?: string;

  @IsOptional()
  @IsUUID("all")
  serviceId?: string;

  @IsOptional()
  @IsUUID("all")
  classGroupId?: string;
}
