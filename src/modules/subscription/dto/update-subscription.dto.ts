import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import {
  BillingCycle,
  SubscriptionPlan,
} from "../../../../generated/prisma/enums";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = "Informe a data no formato AAAA-MM-DD";

// Cria ou substitui a assinatura da empresa (PUT, só SUPER_ADMIN).
export class UpdateSubscriptionDto {
  @IsIn(Object.values(SubscriptionPlan), { message: "Plano inválido" })
  plan!: SubscriptionPlan;

  @IsIn(Object.values(BillingCycle), { message: "Ciclo inválido" })
  cycle!: BillingCycle;

  @Type(() => Number)
  @IsInt({ message: "Informe quantos profissionais extras" })
  @Min(0)
  @Max(99)
  extraProfessionals!: number;

  @IsBoolean()
  anamnesisAddon!: boolean;

  /** Valor do ciclo (o SUPER_ADMIN pode negociar outro que não o sugerido). */
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: "Informe o valor com até duas casas decimais" },
  )
  @Min(0.01, { message: "O valor precisa ser maior que zero" })
  price!: number;

  /** Oferta de lançamento: os dois juntos, ou nenhum. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "Informe o desconto em número inteiro" })
  @Min(1)
  @Max(100)
  discountPercent?: number | null;

  @ValidateIf((dto: UpdateSubscriptionDto) => dto.discountPercent != null)
  @Matches(DATE, { message: "Informe até quando vale o desconto (AAAA-MM-DD)" })
  discountUntil?: string | null;

  @IsOptional()
  @Matches(DATE, { message: DATE_MESSAGE })
  trialEndsAt?: string | null;

  @IsOptional()
  @Matches(DATE, { message: DATE_MESSAGE })
  paidUntil?: string | null;

  @IsOptional()
  @Matches(DATE, { message: DATE_MESSAGE })
  canceledAt?: string | null;
}
