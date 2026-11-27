import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import {
  formatAnswer,
  formatDate,
  formatDateTime,
  yesNoDetail,
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
// Até este tamanho, a pergunta e a resposta não se separam entre páginas. Uma
// resposta maior (texto longo vai a 5.000 caracteres) pode passar de uma
// página, e um bloco indivisível assim seria cortado: ela quebra normalmente.
const KEEP_TOGETHER_MAX_CHARS = 1200;
// Largura útil da página A4 (595 pt) menos as margens laterais (40 + 40).
const CONTENT_WIDTH = 515;

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
    .map((question) => {
      const detail = yesNoDetail(question, byQuestion.get(question.id));
      const answer = formatAnswer(question, byQuestion.get(question.id));
      return {
        // O título não fica sozinho no fim da página, longe da resposta.
        unbreakable:
          answer.length + (detail?.text.length ?? 0) <= KEEP_TOGETHER_MAX_CHARS,
        stack: [
          { text: question.label, bold: true },
          ...(question.helpText
            ? [{ text: question.helpText, italics: true, fontSize: 8 }]
            : []),
          // Folga entre a pergunta e a resposta, e entre uma pergunta e a outra,
          // para a leitura não embolar.
          {
            text: answer,
            margin: [0, 2, 0, 0] as [number, number, number, number],
          },
          // O "Qual?" do sim vem abaixo da resposta, como uma pergunta própria.
          ...(detail
            ? [
                {
                  text: detail.label,
                  bold: true,
                  margin: [0, 4, 0, 0] as [number, number, number, number],
                },
                {
                  text: detail.text,
                  margin: [0, 2, 0, 0] as [number, number, number, number],
                },
              ]
            : []),
        ],
        margin: [0, 0, 0, 16] as [number, number, number, number],
      };
    });
};

// Linha fina e cinza que separa os dados de quem emite e de quem é atendido
// das respostas, no lugar de um título. É uma função porque o pdfmake altera o
// nó ao desenhar: um objeto compartilhado quebraria o PDF seguinte.
const divider = (): Content => ({
  canvas: [
    {
      type: "line",
      x1: 0,
      y1: 0,
      x2: CONTENT_WIDTH,
      y2: 0,
      lineWidth: 0.5,
      lineColor: "#d4d4d8",
    },
  ],
  margin: [0, 8, 0, 12],
});

const signatureBlock = (
  clientName: string,
  responsibilityTerm: string | null,
): Content => ({
  // Mantém o termo, a linha e o nome juntos, na mesma página.
  unbreakable: true,
  stack: [
    // O termo vem logo acima da assinatura: é o que o cliente declara ao assinar.
    ...(responsibilityTerm
      ? [
          {
            text: responsibilityTerm,
            alignment: "justify" as const,
            fontSize: 9,
            margin: [0, 16, 0, 0] as [number, number, number, number],
          },
        ]
      : []),
    {
      // O canvas não centraliza sozinho: a margem à esquerda põe a linha no
      // meio da página.
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
      margin: [(CONTENT_WIDTH - SIGNATURE_LINE_WIDTH) / 2, 48, 0, 4],
    },
    { text: clientName, alignment: "center" },
    {
      text: "Data: ____/____/________",
      alignment: "center",
      margin: [0, 8, 0, 0],
    },
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
 * - a **ficha**, com as respostas do registro inicial, o termo de
 *   responsabilidade da versão (se houver) e a assinatura do cliente:
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
      title: { fontSize: 16, bold: true, alignment: "center" },
      section: { fontSize: 12, bold: true, margin: [0, 10, 0, 6] },
    },
    info: { title: "Ficha de anamnese" },
    // A clínica identifica todas as páginas: com logo, só ela, centralizada (o
    // nome já está no bloco "Clínica"); sem logo, o nome no canto.
    header: clinicLogo
      ? {
          // Em stack, para o pdfmake centralizar a imagem na largura da página
          // (solta no cabeçalho, ela sai deslocada). A logo cabe numa caixa
          // fixa, qualquer que seja a proporção da imagem.
          stack: [{ image: clinicLogo, fit: [120, 30], alignment: "center" }],
          margin: [40, 16, 40, 0],
        }
      : {
          text: clinic.name,
          alignment: "right",
          fontSize: 8,
          margin: [40, 26, 40, 0],
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
        alignment: "center",
        margin: [0, 0, 0, 8],
      },
      // A clínica aparece só no cabeçalho (logo ou nome): no corpo, os dados
      // do cliente.
      { text: "Dados do cliente", style: "section" },
      detailsTable(client),
      divider(),
      {
        text: `Consulta de ${formatDate(initial.consultationDate)} — ${authorOf(initial)}`,
        italics: true,
        margin: [0, 0, 0, 6],
      },
      ...answersOf(questions, initial, { onlyAnswered: false }),
      signatureBlock(client.name, view.version.responsibilityTerm),
      ...(includeHistory ? historySection(questions, followUps) : []),
    ],
  };
}
