import { Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import {
  CLASS_GROUP_CAPACITY_MAX,
  CLASS_GROUP_CAPACITY_MIN,
  CLASS_GROUP_NAME_MAX,
} from "./create-class-group.dto";

// Serviço, profissional e dias não mudam: para mudá-los, inativa-se a turma e
// cria-se outra. Enviá-los aqui é recusado pela validação (campo não permitido).
export class UpdateClassGroupDto {
  /** `null` remove o nome. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CLASS_GROUP_NAME_MAX)
  name?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(CLASS_GROUP_CAPACITY_MIN)
  @Max(CLASS_GROUP_CAPACITY_MAX)
  capacity?: number;

  /** Inativar impede novos encaixes; reativar confere de novo serviço, profissional e horários. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
