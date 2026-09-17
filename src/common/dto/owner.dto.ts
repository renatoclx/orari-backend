import { IsOptional, IsUUID, ValidateIf } from "class-validator";
import { ExactlyOneOf } from "../validators/exactly-one-of.validator";
import { isFilled } from "../validators/is-filled";

// Base para registros que pertencem a exatamente um dono: empresa ou pessoa.
export class OwnerDto {
  // Também valida quando nenhum dono é informado, para que ExactlyOneOf acuse a ausência.
  @ValidateIf(
    (dto: OwnerDto) => isFilled(dto.companyId) || !isFilled(dto.peopleId),
  )
  @ExactlyOneOf(["companyId", "peopleId"])
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  peopleId?: string;
}
