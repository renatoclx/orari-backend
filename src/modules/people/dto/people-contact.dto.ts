import { OmitType } from "@nestjs/swagger";
import { CreateContactDto } from "../../contact/dto/create-contact.dto";

/**
 * Contato enviado junto com a pessoa. As mesmas validações do contato avulso
 * (telefone e/ou e-mail), sem o dono: ele é a pessoa que está sendo criada.
 */
export class PeopleContactDto extends OmitType(CreateContactDto, [
  "companyId",
  "peopleId",
] as const) {}
