import { IsEnum, IsOptional, IsUUID } from "class-validator";
import { PaymentStatus } from "../../../../generated/prisma/enums";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export class FindPaymentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  // Pagamentos de uma contratação de plano (integral ou parcelas mensais).
  @IsOptional()
  @IsUUID()
  clientPlanId?: string;

  @IsOptional()
  @IsUUID()
  paymentMethodId?: string;
}
