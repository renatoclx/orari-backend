import { Type } from "class-transformer";
import { IsInt, IsNumber, Max, Min } from "class-validator";

// Período de contratação: número de meses e os dois percentuais de desconto.
export class PlanPeriodDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  months!: number;

  /** Desconto sobre o total do período no pagamento integral. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPercent!: number;

  /** Desconto sobre cada parcela no pagamento mensal. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  monthlyDiscountPercent!: number;
}
