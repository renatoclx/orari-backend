import { OmitType, PartialType } from "@nestjs/mapped-types";
import { CreateAddressDto } from "./create-address.dto";

// O dono (empresa ou pessoa) é definido na criação e não pode ser trocado.
export class UpdateAddressDto extends PartialType(
  OmitType(CreateAddressDto, ["companyId", "peopleId"] as const),
) {}
