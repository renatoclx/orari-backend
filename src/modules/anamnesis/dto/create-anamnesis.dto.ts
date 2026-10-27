import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from "class-validator";
import { MAX_QUESTIONS } from "./create-anamnesis-template.dto";
import { AnamnesisAnswerDto } from "./anamnesis-answer.dto";

// Data da consulta (AAAA-MM-DD). Que a data exista e não seja futura é conferido no service.
export const CONSULTATION_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// A empresa não é informada: a ficha pertence à empresa do usuário autenticado.
export class CreateAnamnesisDto {
  @IsUUID("all")
  clientId!: string;

  @IsUUID("all")
  templateId!: string;

  /** Sem informar, vale hoje no fuso da empresa. Pode ser passada, não futura. */
  @IsOptional()
  @IsString()
  @Matches(CONSULTATION_DATE_PATTERN, {
    message: "consultationDate deve estar no formato AAAA-MM-DD",
  })
  consultationDate?: string;

  /** Respostas do registro inicial; as perguntas obrigatórias não podem faltar. */
  @IsArray()
  @ArrayMaxSize(MAX_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => AnamnesisAnswerDto)
  answers!: AnamnesisAnswerDto[];
}
