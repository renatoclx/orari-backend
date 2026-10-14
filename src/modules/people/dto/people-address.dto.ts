import { OmitType } from "@nestjs/swagger";
import { CreateAddressDto } from "../../address/dto/create-address.dto";

/**
 * Endereço enviado junto com a pessoa. As mesmas validações do endereço
 * avulso, sem o dono: ele é a pessoa que está sendo criada.
 */
export class PeopleAddressDto extends OmitType(CreateAddressDto, [
  "companyId",
  "peopleId",
] as const) {}
