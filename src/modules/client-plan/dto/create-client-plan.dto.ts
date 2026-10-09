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

  // Precisa corresponder a um período cadastrado no plano.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  months!: number;

  @IsEnum(PlanBillingType)
  billingType!: PlanBillingType;

  // Opcional: sem ele, a contratação começa hoje (no fuso da empresa).
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  // Opcional: vencimento do primeiro pagamento; os seguintes vencem mês a mês.
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  firstDueDate?: Date;

  // Uma agenda para cada serviço do plano.
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ClientPlanScheduleDto)
  schedules!: ClientPlanScheduleDto[];
}
