import { Type } from "class-transformer";
import { IsDate, IsEnum, IsOptional, IsUUID } from "class-validator";
import { AuditAction } from "../../../../generated/prisma/enums";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export class FindAuditLogsQueryDto extends PaginationQueryDto {
  /** Registros que se referem a este cliente. */
  @IsOptional()
  @IsUUID()
  clientId?: string;

  /** Registros das ações executadas por este usuário. */
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  /** Início do período, incluído. Sem horário, vale a meia-noite UTC (prefira data e hora completas). */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  /** Fim do período, incluído. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
