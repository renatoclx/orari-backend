import { BadRequestException } from "@nestjs/common";
import { AnamnesisQuestionType } from "../../../generated/prisma/enums";
import { AnamnesisAnswerDto } from "./dto/anamnesis-answer.dto";

// Limite do texto de uma resposta (ver docs/business-rules.md, "Anamnese").
export const MAX_TEXT_ANSWER = 5000;
const SCALE_MAX = 10;

// Pergunta como a validação a enxerga (um recorte do que vem do banco).
export interface AnswerableQuestion {
  id: string;
  label: string;
  type: AnamnesisQuestionType;
  isRequired: boolean;
  options: string[];
  detailLabel: string | null;
}

export interface YesNoAnswer {
  answer: boolean;
  detail?: string;
}

// Forma em que cada tipo de resposta é guardado (em JSON, criptografado).
export type AnswerValue = string | number | string[] | YesNoAnswer;

export interface ResolvedAnswer {
  questionId: string;
  value: AnswerValue;
}

/**
 * Data no formato AAAA-MM-DD, aceitando só datas que existem (31/02 não passa).
 * Devolve a data à meia-noite UTC, como as colunas `date` são lidas e gravadas.
 */
export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);

  // Datas inexistentes são "corrigidas" pelo JS (31/02 vira março); a volta ao texto denuncia.
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Valida uma resposta pelo tipo da pergunta e devolve o valor na forma em que é
 * guardado. Recusa com 400 citando a pergunta.
 */
export function validateAnswerValue(
  question: AnswerableQuestion,
  value: unknown,
): AnswerValue {
  const fail = (reason: string): never => {
    throw new BadRequestException(
      `Resposta da pergunta "${question.label}": ${reason}`,
    );
  };

  switch (question.type) {
    case AnamnesisQuestionType.SHORT_TEXT:
    case AnamnesisQuestionType.LONG_TEXT:
      return validateText(value, fail);

    case AnamnesisQuestionType.YES_NO:
      return validateYesNo(question, value, fail);

    case AnamnesisQuestionType.SINGLE_CHOICE:
      if (typeof value !== "string" || !question.options.includes(value)) {
        return fail("escolha uma das opções da pergunta");
      }
      return value;

    case AnamnesisQuestionType.MULTIPLE_CHOICE:
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        !value.every(
          (item): item is string =>
            typeof item === "string" && question.options.includes(item),
        )
      ) {
        return fail("escolha uma ou mais opções da pergunta");
      }
      if (new Set(value).size !== value.length) {
        return fail("as opções escolhidas não podem se repetir");
      }
      return value;

    case AnamnesisQuestionType.NUMBER:
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return fail("informe um número");
      }
      return value;

    case AnamnesisQuestionType.DATE:
      if (typeof value !== "string" || !parseIsoDate(value)) {
        return fail("informe uma data válida no formato AAAA-MM-DD");
      }
      return value;

    case AnamnesisQuestionType.SCALE:
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > SCALE_MAX
      ) {
        return fail(`informe um número inteiro de 0 a ${SCALE_MAX}`);
      }
      return value;
  }
}

function validateText(value: unknown, fail: (reason: string) => never): string {
  if (typeof value !== "string" || value.trim() === "") {
    return fail("informe um texto");
  }
  if (value.length > MAX_TEXT_ANSWER) {
    return fail(`o texto aceita até ${MAX_TEXT_ANSWER} caracteres`);
  }
  return value;
}

// Sim ou não: { answer, detail? }. O detalhe só existe se a pergunta o prevê e a resposta é "sim".
function validateYesNo(
  question: AnswerableQuestion,
  value: unknown,
  fail: (reason: string) => never,
): YesNoAnswer {
  if (
    !isPlainObject(value) ||
    typeof value.answer !== "boolean" ||
    Object.keys(value).some((key) => key !== "answer" && key !== "detail")
  ) {
    return fail('informe { "answer": true|false } e, se couber, "detail"');
  }

  if (value.detail === undefined) {
    return { answer: value.answer };
  }
  if (!question.detailLabel) {
    return fail("esta pergunta não tem detalhe");
  }
  if (!value.answer) {
    return fail('o detalhe só vale quando a resposta é "sim"');
  }

  return { answer: true, detail: validateText(value.detail, fail) };
}

/**
 * Valida as respostas de um registro contra as perguntas da versão da ficha:
 * cada pergunta existe nela e é respondida no máximo uma vez. No registro
 * inicial (`requireAll`), as obrigatórias não podem faltar; no acompanhamento
 * vêm só as que mudaram.
 */
export function resolveAnswers(
  questions: AnswerableQuestion[],
  answers: AnamnesisAnswerDto[],
  { requireAll }: { requireAll: boolean },
): ResolvedAnswer[] {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const seen = new Set<string>();

  const resolved = answers.map(({ questionId, value }) => {
    const question = byId.get(questionId);
    if (!question) {
      throw new BadRequestException(
        `A pergunta ${questionId} não pertence a esta ficha`,
      );
    }
    if (seen.has(questionId)) {
      throw new BadRequestException(
        `A pergunta "${question.label}" foi respondida mais de uma vez`,
      );
    }
    seen.add(questionId);

    return { questionId, value: validateAnswerValue(question, value) };
  });

  if (requireAll) {
    const missing = questions
      .filter((question) => question.isRequired && !seen.has(question.id))
      .map((question) => `"${question.label}"`);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Perguntas obrigatórias sem resposta: ${missing.join(", ")}`,
      );
    }
  }

  return resolved;
}
