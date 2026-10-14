// @Type (class-transformer) depende do reflect-metadata, que em runtime é carregado pelo Nest.
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreatePeopleDto } from "./create-people.dto";
import { UpdatePeopleDto } from "./update-people.dto";

const payload = {
  name: "Maria",
  document: "52998224725",
  birthDate: "1990-05-20",
  type: "CLIENT",
};

async function errorsFor(body: object) {
  const errors = await validate(plainToInstance(CreatePeopleDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

// Mensagens de validação dos itens aninhados (contacts[0].phone, addresses[0].cep...).
async function nestedErrorsFor(body: object) {
  const errors = await validate(plainToInstance(CreatePeopleDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const flat = (list: typeof errors, prefix = ""): string[] =>
    list.flatMap((error) => {
      const path = `${prefix}${error.property}`;
      return [
        ...(error.constraints ? [path] : []),
        ...flat(error.children ?? [], `${path}.`),
      ];
    });
  return flat(errors);
}

const address = {
  type: "MAIN",
  cep: "30130000",
  street: "Rua da Bahia",
  number: "100",
  cityId: "8f14e45f-ceea-4c6a-9f1b-6d2f1c3b7a10",
};

describe("CreatePeopleDto: cadastro completo", () => {
  it("deve aceitar observação, telefone, contatos e endereços", async () => {
    await expect(
      nestedErrorsFor({
        ...payload,
        note: "Prefere atendimento pela manhã",
        phone: "31999999999",
        contacts: [
          { type: "MESSAGE", phone: "3133334444" },
          { type: "BRANCH", email: "filial@orari.local" },
        ],
        addresses: [{ ...address, isPrincipal: true }],
      }),
    ).resolves.toEqual([]);
  });

  it("deve recusar observação acima de 1000 caracteres e aceitar exatamente 1000", async () => {
    await expect(
      errorsFor({ ...payload, note: "a".repeat(1001) }),
    ).resolves.toEqual(["note"]);
    await expect(
      errorsFor({ ...payload, note: "a".repeat(1000) }),
    ).resolves.toEqual([]);
  });

  it("deve validar o telefone principal como o telefone do contato", async () => {
    await expect(errorsFor({ ...payload, phone: "12345" })).resolves.toEqual([
      "phone",
    ]);
    await expect(
      errorsFor({ ...payload, phone: "(31) 99999-9999" }),
    ).resolves.toEqual(["phone"]);
  });

  it("deve herdar as validações do contato avulso: telefone e/ou e-mail", async () => {
    await expect(
      nestedErrorsFor({ ...payload, contacts: [{ type: "MAIN" }] }),
    ).resolves.toContain("contacts.0.phone");
    await expect(
      nestedErrorsFor({
        ...payload,
        contacts: [{ type: "MAIN", email: "invalido" }],
      }),
    ).resolves.toEqual(["contacts.0.email"]);
  });

  it("deve herdar as validações do endereço avulso", async () => {
    await expect(
      nestedErrorsFor({
        ...payload,
        addresses: [{ ...address, cep: "123", street: "" }],
      }),
    ).resolves.toEqual(["addresses.0.cep", "addresses.0.street"]);
  });

  it("não deve aceitar dono nos itens: contatos e endereços pertencem à pessoa criada", async () => {
    const owner = "8f14e45f-ceea-4c6a-9f1b-6d2f1c3b7a10";

    await expect(
      nestedErrorsFor({
        ...payload,
        contacts: [{ type: "MAIN", phone: "31999999999", peopleId: owner }],
      }),
    ).resolves.toEqual(["contacts.0.peopleId"]);
    await expect(
      nestedErrorsFor({
        ...payload,
        addresses: [{ ...address, companyId: owner }],
      }),
    ).resolves.toEqual(["addresses.0.companyId"]);
  });

  it("deve limitar as listas a 10 itens", async () => {
    const contacts = Array.from({ length: 11 }, () => ({
      type: "MESSAGE",
      phone: "3133334444",
    }));

    await expect(errorsFor({ ...payload, contacts })).resolves.toEqual([
      "contacts",
    ]);
  });
});

describe("UpdatePeopleDto", () => {
  async function updateErrorsFor(body: object) {
    const errors = await validate(plainToInstance(UpdatePeopleDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return errors.map((error) => error.property);
  }

  it("deve aceitar a observação na edição", async () => {
    await expect(updateErrorsFor({ note: "Nova observação" })).resolves.toEqual(
      [],
    );
  });

  it("não deve aceitar telefone, contatos nem endereços na edição", async () => {
    await expect(
      updateErrorsFor({
        phone: "31999999999",
        contacts: [{ type: "MAIN", phone: "31999999999" }],
        addresses: [address],
      }),
    ).resolves.toEqual(["phone", "contacts", "addresses"]);
  });
});

describe("CreatePeopleDto", () => {
  it("deve aceitar um payload válido", async () => {
    await expect(errorsFor(payload)).resolves.toEqual([]);
  });

  it("deve aceitar só nome e tipo: CPF e nascimento são opcionais", async () => {
    await expect(errorsFor({ name: "Maria", type: "CLIENT" })).resolves.toEqual(
      [],
    );
  });

  it("deve recusar CPF inválido", async () => {
    await expect(
      errorsFor({ ...payload, document: "12345678901" }),
    ).resolves.toEqual(["document"]);
  });

  it("não deve aceitar companyId: a empresa vem do usuário autenticado", async () => {
    await expect(
      errorsFor({
        ...payload,
        companyId: "8f14e45f-ceea-4c6a-9f1b-6d2f1c3b7a10",
      }),
    ).resolves.toEqual(["companyId"]);
  });
});
