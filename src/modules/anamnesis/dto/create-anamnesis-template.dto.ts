import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { AnamnesisQuestionDto } from "./anamnesis-question.dto";

export const MAX_QUESTIONS = 100;

// A empresa não é informada: o modelo pertence à empresa do usuário autenticado.
export class CreateAnamnesisTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  /** Perguntas na ordem em que aparecem na ficha (de 1 a 100). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => AnamnesisQuestionDto)
  questions!: AnamnesisQuestionDto[];
}
