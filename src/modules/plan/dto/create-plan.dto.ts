import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import { PlanPeriodDto } from "./plan-period.dto";
import { PlanServiceItemDto } from "./plan-service-item.dto";

// A empresa não é informada: o plano pertence à empresa do usuário autenticado.
export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  /** Definido pela empresa: não depende dos preços dos serviços do plano. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyPrice!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * O plano precisa de ao menos um serviço, sem repetir o mesmo (a repetição é
   * conferida no service, pois o ArrayUnique não compara objetos).
   */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PlanServiceItemDto)
  services!: PlanServiceItemDto[];

  /**
   * Opcional: o plano pode ser montado aos poucos, mas só é contratado com um
   * período.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanPeriodDto)
  periods?: PlanPeriodDto[];
}
