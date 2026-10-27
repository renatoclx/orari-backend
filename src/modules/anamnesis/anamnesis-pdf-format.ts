import { AnamnesisQuestionType } from "../../../generated/prisma/enums";
import { toZonedParts } from "../../common/time/time-zone";
import { AnswerValue, YesNoAnswer } from "./anamnesis-answer-rules";

// Textos prontos para o PDF (funções puras: a montagem do documento só os junta).

const pad = (value: number) => String(value).padStart(2, "0");

/** Data de coluna `date` (meia-noite UTC) como dd/mm/aaaa. */
export function formatDate(date: Date): string {
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

/** Instante como dd/mm/aaaa HH:mm no relógio da empresa. */
export function formatDateTime(date: Date, timeZone: string): string {
  const { year, month, day, hours, minutes } = toZonedParts(date, timeZone);

  return `${pad(day)}/${pad(month)}/${year} ${pad(hours)}:${pad(minutes)}`;
}

/** Idade em anos completos na data de hoje (no relógio da empresa); null sem nascimento. */
export function ageInYears(
  birthDate: Date | null,
  now: Date,
  timeZone: string,
): number | null {
  if (!birthDate) {
    return null;
  }
  const today = toZonedParts(now, timeZone);
  const birthMonth = birthDate.getUTCMonth() + 1;
  const birthDay = birthDate.getUTCDate();
  const hadBirthday =
    today.month > birthMonth ||
    (today.month === birthMonth && today.day >= birthDay);

  return today.year - birthDate.getUTCFullYear() - (hadBirthday ? 0 : 1);
}

/** CPF (11) ou CNPJ (14, numérico ou alfanumérico) com máscara; outro tamanho segue como está. */
export function formatDocument(document: string): string {
  if (document.length === 11) {
    return document.replace(/^(.{3})(.{3})(.{3})(.{2})$/, "$1.$2.$3-$4");
  }
  if (document.length === 14) {
    return document.replace(
      /^(.{2})(.{3})(.{3})(.{4})(.{2})$/,
      "$1.$2.$3/$4-$5",
    );
  }
  return document;
}

/** Telefone de 10 ou 11 dígitos (DDD + número) com máscara. */
export function formatPhone(phone: string): string {
  return phone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3");
}

interface AddressParts {
  cep: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string | null;
  city: { name: string; state: { acronym: string } };
}

/** "Rua A, 10, apto 2 - Centro - Cidade/UF - CEP 12345-678". */
export function formatAddress(address: AddressParts): string {
  const street = [address.street, address.number, address.complement]
    .filter(Boolean)
    .join(", ");

  return [
    street,
    address.neighborhood,
    `${address.city.name}/${address.city.state.acronym}`,
    `CEP ${address.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2")}`,
  ]
    .filter(Boolean)
    .join(" - ");
}

interface QuestionForPdf {
  type: AnamnesisQuestionType;
  detailLabel: string | null;
}

/** Resposta como aparece no papel; sem resposta, um traço. */
export function formatAnswer(
  question: QuestionForPdf,
  value: AnswerValue | undefined,
): string {
  if (value === undefined) {
    return "—";
  }

  switch (question.type) {
    case AnamnesisQuestionType.YES_NO: {
      const { answer, detail } = value as YesNoAnswer;
      if (!answer) {
        return "Não";
      }
      return detail
        ? `Sim — ${question.detailLabel ?? "Detalhe"}: ${detail}`
        : "Sim";
    }
    case AnamnesisQuestionType.MULTIPLE_CHOICE:
      return (value as string[]).join(", ");
    case AnamnesisQuestionType.DATE: {
      const [year, month, day] = (value as string).split("-");
      return `${day}/${month}/${year}`;
    }
    case AnamnesisQuestionType.NUMBER:
      return (value as number).toLocaleString("pt-BR");
    case AnamnesisQuestionType.SCALE:
      return `${value as number} de 10`;
    default:
      return value as string;
  }
}
