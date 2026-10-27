import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import { AnamnesisQuestionType } from "../../../../generated/prisma/enums";

// Limites do texto das perguntas (ver docs/business-rules.md, "Anamnese").
export const QUESTION_LABEL_MAX = 400;
export const QUESTION_HELP_MAX = 500;
export const QUESTION_OPTION_MAX = 100;
export const MAX_OPTIONS = 50;

// Pergunta de um modelo. A posição não é informada: vale a ordem da lista.
export class AnamnesisQuestionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(QUESTION_LABEL_MAX)
  label!: string;

  /** Texto de apoio exibido junto da pergunta. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(QUESTION_HELP_MAX)
  helpText?: string;

  @IsEnum(AnamnesisQuestionType)
  type!: AnamnesisQuestionType;

  /** Sem informar, a pergunta é opcional. */
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  /**
   * Obrigatório em escolha única e múltipla (2 ou mais, sem repetir); nos demais
   * tipos não é aceito. Essas regras dependem do tipo e ficam no
   * validateQuestions.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_OPTIONS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(QUESTION_OPTION_MAX, { each: true })
  options?: string[];

  /** Texto do detalhe pedido quando a resposta é "sim" (ex.: "Qual?"). Só em sim ou não. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(QUESTION_LABEL_MAX)
  detailLabel?: string;
}
