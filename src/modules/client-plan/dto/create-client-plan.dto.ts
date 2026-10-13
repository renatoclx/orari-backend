import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { PlanBillingType } from "../../../../generated/prisma/enums";
import { ClientPlanScheduleDto } from "./client-plan-schedule.dto";

// A empresa vem do usuário autenticado. Os valores são calculados pelo sistema.
export class CreateClientPlanDto {
  @IsUUID()
  clientId!: string;

  @IsUUID()
  planId!: string;

  /** Precisa corresponder a um período cadastrado no plano. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  months!: number;

  @IsEnum(PlanBillingType)
  billingType!: PlanBillingType;

  /** Opcional: sem ele, a contratação começa hoje (no fuso da empresa). */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  /**
   * Vencimento do primeiro pagamento; os seguintes vencem mês a mês.
   * Obrigatório no mensal, opcional no integral.
   */
  // Sem vencimento, o cancelamento não distinguiria parcelas atrasadas das futuras.
  @ValidateIf(
    (dto: CreateClientPlanDto) =>
      dto.billingType === PlanBillingType.MONTHLY ||
      dto.firstDueDate !== undefined,
  )
  @Type(() => Date)
  @IsDate()
  firstDueDate?: Date;

  /** Uma agenda para cada serviço do plano. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ClientPlanScheduleDto)
  schedules!: ClientPlanScheduleDto[];
}
