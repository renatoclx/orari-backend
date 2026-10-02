import { OmitType, PartialType } from "@nestjs/swagger";
import { CreatePaymentDto } from "./create-payment.dto";

// O agendamento é definido na criação: cada agendamento tem um pagamento.
export class UpdatePaymentDto extends PartialType(
  OmitType(CreatePaymentDto, ["appointmentId"] as const),
) {}
