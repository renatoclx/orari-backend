import { describe, expect, it } from "vitest";
import { buildAnamnesisPdf } from "./anamnesis-pdf-document";
import type { AnamnesisView } from "./anamnesis.service";

const questions = [
  {
    id: "q1",
    position: 1,
    label: "Tem alergia?",
    helpText: "Inclui medicamentos",
    type: "YES_NO",
    isRequired: true,
    options: [],
    detailLabel: "Qual?",
  },
  {
    id: "q2",
    position: 2,
    label: "Nível de dor",
    helpText: null,
    type: "SCALE",
    isRequired: false,
    options: [],
    detailLabel: null,
  },
  {
    id: "q3",
    position: 3,
    label: "Esportes",
    helpText: null,
    type: "SHORT_TEXT",
    isRequired: false,
    options: [],
    detailLabel: null,
  },
] as AnamnesisView["version"]["questions"];

const entry = (overrides: Record<string, unknown>) => ({
  id: "e",
  kind: "INITIAL",
  consultationDate: new Date("2026-10-20T00:00:00Z"),
  appointmentId: null,
  evolution: null,
  authorUser: { id: "u1", name: "Admin" },
  authorProfessional: { id: "p1", name: "Dra. Paula" },
  createdAt: new Date("2026-10-20T12:00:00Z"),
  answers: [],
  ...overrides,
});

const view = {
  id: "anamnesis-1",
  createdAt: new Date("2026-10-20T12:00:00Z"),
  client: { id: "c1", name: "Joana" },
  template: { id: "t1", name: "Fisioterapia" },
  version: { id: "v1", version: 2, questions },
  current: [],
  entries: [
    entry({
      answers: [
        { questionId: "q1", value: { answer: true, detail: "Dipirona" } },
        { questionId: "q2", value: 7 },
      ],
    }),
    entry({
      id: "e2",
      kind: "FOLLOW_UP",
      consultationDate: new Date("2026-10-25T00:00:00Z"),
      evolution: "Dor reduzida após as sessões",
      authorProfessional: null,
      answers: [{ questionId: "q2", value: 2 }],
    }),
  ],
} as unknown as AnamnesisView;

const input = {
  view,
  clinic: {
    name: "Clínica Bem Estar",
    details: [["CPF/CNPJ", "11.222.333/0001-81"]] as [string, string][],
  },
  client: {
    name: "Joana Souza",
    details: [
      ["Nome", "Joana Souza"],
      ["Idade", "36 anos"],
      ["CPF", null],
    ] as [string, string | null][],
  },
  issuedAt: new Date("2026-10-27T15:00:00Z"),
  timeZone: "America/Sao_Paulo",
  includeHistory: true,
};

// A definição é um objeto aninhado: o texto todo pode ser conferido pelo JSON.
const textOf = (definition: object) => JSON.stringify(definition);

describe("buildAnamnesisPdf", () => {
  it("a ficha traz as respostas do registro inicial, não as atualizações", () => {
    const text = textOf(buildAnamnesisPdf(input));

    expect(text).toContain("Sim — Qual?: Dipirona");
    expect(text).toContain("7 de 10");
    // Pergunta sem resposta aparece com traço.
    expect(text).toContain("—");
    // A resposta atualizada (2) só aparece no histórico, não como valor da ficha.
    const content = buildAnamnesisPdf({ ...input, includeHistory: false });
    expect(textOf(content)).not.toContain("2 de 10");
  });

  it("identifica a clínica, o cliente e o modelo, e omite dados ausentes", () => {
    const text = textOf(buildAnamnesisPdf(input));

    expect(text).toContain("Clínica Bem Estar");
    expect(text).toContain("11.222.333/0001-81");
    expect(text).toContain("Joana Souza");
    expect(text).toContain("36 anos");
    expect(text).toContain("Fisioterapia · versão 2");
    // O CPF ausente não vira linha vazia na tabela.
    expect(text).not.toContain('"CPF"');
  });

  it("tem só a assinatura do cliente", () => {
    const text = textOf(buildAnamnesisPdf(input));

    expect(text).toContain("Assinatura do cliente: Joana Souza");
    expect(text).not.toContain("Assinatura do profissional");
  });

  it("o histórico vem em página própria, com autor, evolução e respostas atualizadas", () => {
    const definition = buildAnamnesisPdf(input);
    const text = textOf(definition);

    expect(text).toContain('"pageBreak":"before"');
    expect(text).toContain("Acompanhamento do profissional");
    expect(text).toContain("25/10/2026 — Admin");
    expect(text).toContain("Dor reduzida após as sessões");
    expect(text).toContain("2 de 10");
    // Só as perguntas alteradas entram no acompanhamento.
    expect(text.match(/Respostas atualizadas/g)).toHaveLength(1);
  });

  it("sem includeHistory, imprime só a ficha", () => {
    const text = textOf(buildAnamnesisPdf({ ...input, includeHistory: false }));

    expect(text).not.toContain("Acompanhamento do profissional");
    expect(text).not.toContain("Dor reduzida");
  });

  it("sem acompanhamentos, informa que não há registros", () => {
    const text = textOf(
      buildAnamnesisPdf({
        ...input,
        view: { ...view, entries: [view.entries[0]] },
      }),
    );

    expect(text).toContain("Nenhum acompanhamento registrado.");
  });

  it("o cabeçalho leva a logo quando há e só o nome quando não há", () => {
    const header = (clinicLogo?: string) =>
      textOf(buildAnamnesisPdf({ ...input, clinicLogo }).header as object);

    expect(header("data:image/png;base64,AAAA")).toContain(
      '"image":"data:image/png;base64,AAAA"',
    );
    expect(header("data:image/png;base64,AAAA")).toContain("Clínica Bem Estar");
    expect(header()).not.toContain('"image"');
    expect(header()).toContain("Clínica Bem Estar");
  });

  it("o rodapé tem a emissão no fuso da empresa e a paginação", () => {
    const { footer } = buildAnamnesisPdf(input);
    const footerContent = (footer as (page: number, total: number) => object)(
      2,
      5,
    );

    expect(textOf(footerContent)).toContain("Emitido em 27/10/2026 12:00");
    expect(textOf(footerContent)).toContain("Página 2 de 5");
  });
});
