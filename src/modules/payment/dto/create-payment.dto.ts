import { Type } from "class-transformer";
import {
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from "class-validator";
import { PaymentStatus } from "../../../../generated/prisma/enums";

export class CreatePaymentDto {
  @IsUUID()
  appointmentId!: string;

  // Quando não informado, assume o preço do serviço do agendamento.
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @IsUUID()
  paymentMethodId!: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  // Obrigatório quando o pagamento está PAID e recusado nos demais status.
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  paidAt?: Date;
}
