import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsUUID } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export const CLIENT_PLAN_STATUSES = ["active", "cancelled", "ended"] as const;
export type ClientPlanStatus = (typeof CLIENT_PLAN_STATUSES)[number];

export class FindClientPlansQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  planId?: string;

  /**
   * Situação da contratação, com "hoje" no fuso da empresa. active: não
   * cancelada e com data final a partir de hoje (inclui as que ainda vão
   * começar); cancelled: com data de cancelamento; ended: não cancelada e com
   * data final antes de hoje. Sem o filtro, todas.
   */
  @ApiPropertyOptional({ enum: CLIENT_PLAN_STATUSES })
  @IsOptional()
  @IsIn(CLIENT_PLAN_STATUSES)
  status?: ClientPlanStatus;
}
