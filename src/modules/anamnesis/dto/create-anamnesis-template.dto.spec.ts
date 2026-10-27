// @Type (class-transformer) depende do reflect-metadata, que em runtime é carregado pelo Nest.
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateAnamnesisTemplateDto } from "./create-anamnesis-template.dto";
import { UpdateAnamnesisTemplateDto } from "./update-anamnesis-template.dto";

const question = { label: "Tem alergia?", type: "YES_NO" };
const base = { name: "Pilates", questions: [question] };

async function errorsFor(
  payload: object,
  dto: new () => object = CreateAnamnesisTemplateDto,
) {
  const errors = await validate(plainToInstance(dto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe("CreateAnamnesisTemplateDto", () => {
  it("aceita modelo válido, com campos opcionais", async () => {
    await expect(
      errorsFor({
        ...base,
        description: "Ficha inicial",
        questions: [
          {
            ...question,
            helpText: "Inclui medicamentos",
            isRequired: true,
            detailLabel: "Qual?",
          },
          { label: "Dor", type: "SINGLE_CHOICE", options: ["Leve", "Forte"] },
        ],
      }),
    ).resolves.toEqual([]);
  });

  it("exige nome e ao menos uma pergunta", async () => {
    await expect(errorsFor({ questions: [question] })).resolves.toEqual([
      "name",
    ]);
    await expect(errorsFor({ ...base, questions: [] })).resolves.toEqual([
      "questions",
    ]);
  });

  it("limita a 100 perguntas", async () => {
    const many = Array.from({ length: 101 }, () => question);

    await expect(errorsFor({ ...base, questions: many })).resolves.toEqual([
      "questions",
    ]);
    await expect(
      errorsFor({ ...base, questions: many.slice(0, 100) }),
    ).resolves.toEqual([]);
  });

  it.each([
    ["label com 401 caracteres", { label: "a".repeat(401) }],
    ["helpText com 501 caracteres", { helpText: "a".repeat(501) }],
    ["tipo inexistente", { type: "OUTRO" }],
    ["posição enviada", { position: 1 }],
    ["opção com 101 caracteres", { options: ["a".repeat(101), "b"] }],
    ["opção vazia", { options: ["", "b"] }],
  ])("recusa pergunta com %s", async (_, override) => {
    await expect(
      errorsFor({ ...base, questions: [{ ...question, ...override }] }),
    ).resolves.toEqual(["questions"]);
  });

  it("aceita label com 400 caracteres", async () => {
    await expect(
      errorsFor({
        ...base,
        questions: [{ ...question, label: "a".repeat(400) }],
      }),
    ).resolves.toEqual([]);
  });

  it("não aceita a empresa nem isActive na criação", async () => {
    await expect(errorsFor({ ...base, companyId: "x" })).resolves.toEqual([
      "companyId",
    ]);
    await expect(errorsFor({ ...base, isActive: false })).resolves.toEqual([
      "isActive",
    ]);
  });
});

describe("UpdateAnamnesisTemplateDto", () => {
  it("aceita só isActive, só nome ou corpo vazio", async () => {
    await expect(
      errorsFor({ isActive: false }, UpdateAnamnesisTemplateDto),
    ).resolves.toEqual([]);
    await expect(
      errorsFor({ name: "Novo" }, UpdateAnamnesisTemplateDto),
    ).resolves.toEqual([]);
    await expect(errorsFor({}, UpdateAnamnesisTemplateDto)).resolves.toEqual(
      [],
    );
  });

  it("valida as perguntas quando enviadas", async () => {
    await expect(
      errorsFor({ questions: [] }, UpdateAnamnesisTemplateDto),
    ).resolves.toEqual(["questions"]);
  });
});
