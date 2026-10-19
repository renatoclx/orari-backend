import { Type } from "class-transformer";
import { IsDate, IsEnum, IsIn, IsOptional, IsUUID } from "class-validator";
import { AppointmentStatus } from "../../../../generated/prisma/enums";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export class FindAppointmentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @IsUUID()
  professionalId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  /** Sessões de uma recorrência (ou de um pacote). Sem o filtro, nada muda. */
  @IsOptional()
  @IsUUID()
  recurringAppointmentId?: string;

  /**
   * Início do período, incluído (from <= startAt < to). É um instante ISO 8601
   * em UTC: para o dia 15/10 em São Paulo, use 2026-10-15T03:00:00.000Z. Uma data
   * sem hora vale meia-noite UTC, e não a do fuso da empresa.
   */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  /** Fim do período, excluído. Para um dia inteiro, o início do dia seguinte. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  /**
   * Ordem pelo início: `asc` (padrão, a agenda) ou `desc` (o mais recente
   * primeiro, ex.: atendimentos anteriores no histórico do cliente).
   */
  @IsOptional()
  @IsIn(["asc", "desc"])
  order?: "asc" | "desc";
}
