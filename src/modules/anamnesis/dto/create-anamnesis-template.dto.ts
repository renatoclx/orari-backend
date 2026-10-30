import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { AnamnesisQuestionDto } from "./anamnesis-question.dto";

export const MAX_QUESTIONS = 100;
// Limites do nome e da descrição do modelo (ver docs/business-rules.md, "Anamnese").
export const TEMPLATE_NAME_MAX = 100;
export const TEMPLATE_DESCRIPTION_MAX = 1000;

// A empresa não é informada: o modelo pertence à empresa do usuário autenticado.
export class CreateAnamnesisTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TEMPLATE_NAME_MAX)
  name!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(TEMPLATE_DESCRIPTION_MAX)
  description?: string;

  /** Perguntas na ordem em que aparecem na ficha (de 1 a 100). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => AnamnesisQuestionDto)
  questions!: AnamnesisQuestionDto[];
}
