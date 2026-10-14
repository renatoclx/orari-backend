import { OmitType, PartialType } from "@nestjs/swagger";
import { CreatePeopleDto } from "./create-people.dto";

// Telefone, contatos e endereços são gravados só no cadastro; depois disso, têm
// rotas próprias (/contacts e /addresses).
export class UpdatePeopleDto extends PartialType(
  OmitType(CreatePeopleDto, ["phone", "contacts", "addresses"] as const),
) {}
