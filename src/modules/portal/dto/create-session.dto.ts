import { Transform } from "class-transformer";
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";
import { ExactlyOneOf } from "../../../common/validators/exactly-one-of.validator";
import { isFilled } from "../../../common/validators/is-filled";

// Depois do código conferido: escolher uma das pessoas do telefone OU, se não
// for nenhuma delas, informar o nome para o cadastro ser criado.
export class CreateSessionDto {
  @IsUUID()
  verificationId!: string;

  // Também valida quando nenhum dos dois vem, para que ExactlyOneOf acuse a ausência.
  @ValidateIf(
    (dto: CreateSessionDto) => isFilled(dto.personId) || !isFilled(dto.name),
  )
  @ExactlyOneOf(["personId", "name"])
  @IsUUID()
  personId?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;
}
