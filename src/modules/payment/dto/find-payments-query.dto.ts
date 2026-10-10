import { Transform, Type } from "class-transformer";
import { IsBoolean, IsDate, IsEnum, IsOptional, IsUUID } from "class-validator";
import { PaymentStatus } from "../../../../generated/prisma/enums";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export class FindPaymentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  /** Pagamentos de uma contratação de plano (integral ou parcelas mensais). */
  @IsOptional()
  @IsUUID()
  clientPlanId?: string;

  @IsOptional()
  @IsUUID()
  paymentMethodId?: string;

  /**
   * Pagamentos do cliente, venham de agendamento ou de contratação de plano.
   */
  @IsOptional()
  @IsUUID()
  clientId?: string;

  /** Pagamentos dos agendamentos de uma recorrência. */
  @IsOptional()
  @IsUUID()
  recurringAppointmentId?: string;

  /**
   * true: só atrasados (PENDING com vencimento antes de hoje, no fuso da
   * empresa); false: só os que não estão atrasados.
   */
  // Query string chega como texto; @Type(() => Boolean) converteria "false" em true.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  @IsBoolean()
  overdue?: boolean;

  /**
   * Período de vencimento, com as duas pontas incluídas (ex.: o que vence no
   * mês).
   */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueFrom?: Date;

  /** Fim do período de vencimento, incluído. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueTo?: Date;
}
