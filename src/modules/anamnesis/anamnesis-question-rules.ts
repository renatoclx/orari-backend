import { BadRequestException } from "@nestjs/common";
import { AnamnesisQuestionType } from "../../../generated/prisma/enums";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { AnamnesisQuestionDto } from "./dto/anamnesis-question.dto";

const CHOICE_TYPES: AnamnesisQuestionType[] = [
  AnamnesisQuestionType.SINGLE_CHOICE,
  AnamnesisQuestionType.MULTIPLE_CHOICE,
];
const MIN_CHOICE_OPTIONS = 2;

/**
 * Regras das perguntas que dependem do tipo (o DTO só confere formato e tamanho):
 * - escolha única e múltipla: 2 ou mais opções, sem repetir (ignorando acento e
 *   maiúsculas, pois "Não" e "nao" confundiriam quem responde);
 * - demais tipos: sem opções;
 * - texto de detalhe: só em sim ou não.
 * A mensagem indica a pergunta pelo número, na ordem enviada.
 */
export function validateQuestions(questions: AnamnesisQuestionDto[]): void {
  questions.forEach((question, index) => {
    const fail = (reason: string) => {
      throw new BadRequestException(`Pergunta ${index + 1}: ${reason}`);
    };
    const options = question.options ?? [];

    if (CHOICE_TYPES.includes(question.type)) {
      if (options.length < MIN_CHOICE_OPTIONS) {
        fail(`informe ao menos ${MIN_CHOICE_OPTIONS} opções`);
      }
      const distinct = new Set(options.map(normalizeForSearch));
      if (distinct.size !== options.length) {
        fail("as opções não podem se repetir");
      }
    } else if (options.length > 0) {
      fail("este tipo de pergunta não aceita opções");
    }

    if (
      question.detailLabel !== undefined &&
      question.type !== AnamnesisQuestionType.YES_NO
    ) {
      fail("o texto de detalhe só vale para perguntas de sim ou não");
    }
  });
}
