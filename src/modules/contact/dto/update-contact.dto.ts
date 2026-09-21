import { OmitType, PartialType } from "@nestjs/mapped-types";
import { CreateContactDto } from "./create-contact.dto";

// O dono (empresa ou pessoa) é definido na criação e não pode ser trocado.
export class UpdateContactDto extends PartialType(
  OmitType(CreateContactDto, ["companyId", "peopleId"] as const),
) {}
