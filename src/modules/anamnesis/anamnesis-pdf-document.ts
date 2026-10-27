import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import {
  formatAnswer,
  formatDate,
  formatDateTime,
} from "./anamnesis-pdf-format";
import type { AnamnesisEntryView, AnamnesisView } from "./anamnesis.service";

type Question = AnamnesisView["version"]["questions"][number];

// Dados de quem emite e de quem é atendido, já formatados para o papel.
export interface PdfParty {
  name: string;
  /** Pares rótulo/valor exibidos no bloco; os vazios são omitidos. */
  details: [label: string, value: string | null | undefined][];
}

export interface AnamnesisPdfInput {
  view: AnamnesisView;
  clinic: PdfParty;
  /** Logo da clínica como data URL (PNG ou JPEG); sem ela, o cabeçalho é só texto. */
  clinicLogo?: string | null;
  client: PdfParty;
  issuedAt: Date;
  timeZone: string;
  /** O histórico é controle do profissional: a ficha pode ser impressa sem ele. */
  includeHistory: boolean;
}

const SIGNATURE_LINE_WIDTH = 260;

// Quem registrou: o profissional vinculado ou, sem vínculo, o usuário.
const authorOf = (entry: AnamnesisEntryView) =>
  entry.authorProfessional?.name ?? entry.authorUser.name;

const detailsTable = (party: PdfParty): Content => ({
  table: {
    widths: [90, "*"],
    body: party.details
      .filter(([, value]) => Boolean(value))
      .map(([label, value]) => [
        { text: label, bold: true },
        { text: value as string },
      ]),
  },
  layout: "noBorders",
  margin: [0, 0, 0, 4],
});

const answersOf = (
  questions: Question[],
  entry: AnamnesisEntryView,
  { onlyAnswered }: { onlyAnswered: boolean },
): Content[] => {
  const byQuestion = new Map(
    entry.answers.map((answer) => [answer.questionId, answer.value]),
  );

  return questions
    .filter((question) => !onlyAnswered || byQuestion.has(question.id))
    .map((question) => ({
      stack: [
        { text: question.label, bold: true },
        ...(question.helpText
          ? [{ text: question.helpText, italics: true, fontSize: 8 }]
          : []),
        { text: formatAnswer(question, byQuestion.get(question.id)) },
      ],
      margin: [0, 0, 0, 6] as [number, number, number, number],
    }));
};

const signatureBlock = (clientName: string): Content => ({
  // Mantém a linha e o nome juntos, na mesma página.
  unbreakable: true,
  stack: [
    {
      canvas: [
        {
          type: "line",
          x1: 0,
          y1: 0,
          x2: SIGNATURE_LINE_WIDTH,
          y2: 0,
          lineWidth: 0.8,
        },
      ],
      margin: [0, 48, 0, 4],
    },
    { text: `Assinatura do cliente: ${clientName}` },
    { text: "Data: ____/____/________", margin: [0, 8, 0, 0] },
  ],
});

const historySection = (
  questions: Question[],
  followUps: AnamnesisEntryView[],
): Content[] => [
  {
    text: "Acompanhamento do profissional",
    style: "section",
    pageBreak: "before",
  },
  {
    text: "Registro de controle profissional, anotado conforme a evolução do cliente. Não requer assinatura.",
    italics: true,
    fontSize: 9,
    margin: [0, 0, 0, 8],
  },
  ...(followUps.length === 0
    ? [{ text: "Nenhum acompanhamento registrado." } as Content]
    : followUps.map((entry): Content => ({
        stack: [
          {
            text: `${formatDate(entry.consultationDate)} — ${authorOf(entry)}`,
            bold: true,
          },
          { text: entry.evolution ?? "", margin: [0, 2, 0, 4] },
          ...(entry.answers.length > 0
            ? [
                { text: "Respostas atualizadas", italics: true, fontSize: 9 },
                ...answersOf(questions, entry, { onlyAnswered: true }),
              ]
            : []),
        ],
        margin: [0, 0, 0, 12],
      }))),
];

/**
 * Definição do documento da ficha (pdfmake). Duas partes:
 * - a **ficha**, com as respostas do registro inicial e a assinatura do cliente:
 *   é o que o cliente assina, por isso não traz as atualizações posteriores;
 * - o **histórico**, em página própria, com os acompanhamentos do profissional.
 * Função pura: tudo o que é texto vem pronto no `input`.
 */
export function buildAnamnesisPdf(
  input: AnamnesisPdfInput,
): TDocumentDefinitions {
  const {
    view,
    clinic,
    clinicLogo,
    client,
    issuedAt,
    timeZone,
    includeHistory,
  } = input;
  const [initial, ...followUps] = view.entries;
  const questions = view.version.questions;

  return {
    pageSize: "A4",
    pageMargins: [40, 56, 40, 48],
    defaultStyle: { font: "Roboto", fontSize: 10 },
    styles: {
      title: { fontSize: 16, bold: true },
      section: { fontSize: 12, bold: true, margin: [0, 10, 0, 6] },
    },
    info: { title: "Ficha de anamnese" },
    // A clínica (logo e nome) identifica todas as páginas.
    header: {
      columns: [
        // A logo cabe numa caixa fixa, qualquer que seja a proporção da imagem.
        clinicLogo
          ? { image: clinicLogo, fit: [120, 30], width: 130 }
          : { text: "", width: 130 },
        {
          text: clinic.name,
          alignment: "right",
          fontSize: 8,
          margin: [0, 10, 0, 0],
        },
      ],
      margin: [40, 16, 40, 0],
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `Emitido em ${formatDateTime(issuedAt, timeZone)}` },
        { text: `Página ${currentPage} de ${pageCount}`, alignment: "right" },
      ],
      fontSize: 8,
      margin: [40, 0, 40, 0],
    }),
    content: [
      { text: "Ficha de anamnese", style: "title" },
      {
        text: `${view.template.name} · versão ${view.version.version}`,
        margin: [0, 0, 0, 8],
      },
      { text: "Clínica", style: "section" },
      detailsTable(clinic),
      { text: "Cliente", style: "section" },
      detailsTable(client),
      { text: "Ficha", style: "section" },
      {
        text: `Consulta de ${formatDate(initial.consultationDate)} — ${authorOf(initial)}`,
        italics: true,
        margin: [0, 0, 0, 6],
      },
      ...answersOf(questions, initial, { onlyAnswered: false }),
      signatureBlock(client.name),
      ...(includeHistory ? historySection(questions, followUps) : []),
    ],
  };
}
