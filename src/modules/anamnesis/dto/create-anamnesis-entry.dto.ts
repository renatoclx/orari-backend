import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { AnamnesisAnswerDto } from "./anamnesis-answer.dto";
import { MAX_QUESTIONS } from "./create-anamnesis-template.dto";
import { CONSULTATION_DATE_PATTERN } from "./create-anamnesis.dto";

// Limite do texto da evolução (ver docs/business-rules.md, "Anamnese").
export const MAX_EVOLUTION = 10000;

// Acompanhamento de uma consulta. A ficha vem da rota; a empresa, do usuário.
export class CreateAnamnesisEntryDto {
  /** O que o profissional observou na consulta. */
  @IsString()
  @Matches(/\S/, { message: "evolution não pode ser vazia" })
  @MaxLength(MAX_EVOLUTION)
  evolution!: string;

  /** Sem informar, vale hoje no fuso da empresa. Pode ser passada, não futura nem anterior ao registro inicial. */
  @IsOptional()
  @IsString()
  @Matches(CONSULTATION_DATE_PATTERN, {
    message: "consultationDate deve estar no formato AAAA-MM-DD",
  })
  consultationDate?: string;

  /** Visita a que o acompanhamento se refere: do mesmo cliente da ficha. */
  @IsOptional()
  @IsUUID("all")
  appointmentId?: string;

  /** Só as perguntas cuja resposta mudou; as demais continuam como estavam. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => AnamnesisAnswerDto)
  answers?: AnamnesisAnswerDto[];
}
