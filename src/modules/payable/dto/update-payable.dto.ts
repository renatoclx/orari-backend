import { OmitType, PartialType } from "@nestjs/swagger";
import { CreatePayableDto } from "./create-payable.dto";

// Alterar só a conta (não a série): os mesmos campos, sem repetição nem baixa.
export class UpdatePayableDto extends PartialType(
  OmitType(CreatePayableDto, ["repeat", "paid"] as const),
) {}
