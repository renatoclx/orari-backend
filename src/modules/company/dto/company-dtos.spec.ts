// @Type (class-transformer) depende do reflect-metadata, que em runtime é carregado pelo Nest.
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateCompanyDto } from "./create-company.dto";
import { FindCompaniesQueryDto } from "./find-companies-query.dto";
import { UpdateOwnCompanyDto } from "./update-own-company.dto";

const payload = {
  corporateReason: "Empresa LTDA",
  document: "12abc34501de35",
  foundationDate: "2020-01-15",
  subdomain: "empresa",
};

describe("CreateCompanyDto", () => {
  it("normaliza o CNPJ alfanumérico para maiúsculas antes de validar", async () => {
    const dto = plainToInstance(CreateCompanyDto, payload);

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.document).toBe("12ABC34501DE35");
  });

  it("aceita CPF como documento, sem data de fundação", async () => {
    const { foundationDate: _omitted, ...withoutDate } = payload;
    void _omitted;
    const dto = plainToInstance(CreateCompanyDto, {
      ...withoutDate,
      corporateReason: "Maria Silva",
      document: "52998224725",
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.document).toBe("52998224725");
    expect(dto.foundationDate).toBeUndefined();
  });

  it.each([
    ["CNPJ com dígito verificador inválido", "11222333000182"],
    ["CPF com dígito verificador inválido", "52998224726"],
    ["CPF com máscara", "529.982.247-25"],
    ["tamanho que não é CPF nem CNPJ", "5299822472500"],
  ])("recusa %s", async (_case, document) => {
    const errors = await validate(
      plainToInstance(CreateCompanyDto, { ...payload, document }),
    );

    expect(errors.map((error) => error.property)).toEqual(["document"]);
  });

  it("exige o documento", async () => {
    const { document: _omitted, ...withoutDocument } = payload;
    void _omitted;

    const errors = await validate(
      plainToInstance(CreateCompanyDto, withoutDocument),
    );

    expect(errors.map((error) => error.property)).toEqual(["document"]);
  });

  it("valida a data de fundação quando informada", async () => {
    const errors = await validate(
      plainToInstance(CreateCompanyDto, {
        ...payload,
        foundationDate: "não é data",
      }),
    );

    expect(errors.map((error) => error.property)).toEqual(["foundationDate"]);
  });

  it("recusa o nome antigo do campo (cnpj)", async () => {
    const errors = await validate(
      plainToInstance(CreateCompanyDto, { ...payload, cnpj: "11222333000181" }),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(errors.map((error) => error.property)).toEqual(["cnpj"]);
  });
});

describe("FindCompaniesQueryDto", () => {
  it.each([
    ["true", true],
    ["false", false],
  ])("converte isActive=%s em booleano", async (raw, expected) => {
    const dto = plainToInstance(FindCompaniesQueryDto, { isActive: raw });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.isActive).toBe(expected);
  });

  it("recusa isActive fora de true/false", async () => {
    const errors = await validate(
      plainToInstance(FindCompaniesQueryDto, { isActive: "sim" }),
    );

    expect(errors.map((error) => error.property)).toEqual(["isActive"]);
  });
});

describe("UpdateOwnCompanyDto", () => {
  const validate_ = (body: object) =>
    validate(plainToInstance(UpdateOwnCompanyDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    }).then((errors) => errors.map((error) => error.property));

  it("aceita o nome fantasia e tira os espaços das pontas", async () => {
    const dto = plainToInstance(UpdateOwnCompanyDto, {
      fantasyName: "  Bem Estar  ",
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.fantasyName).toBe("Bem Estar");
  });

  it.each([
    ["texto vazio", ""],
    ["só espaços", "   "],
    ["null", null],
  ])("%s remove o nome fantasia (vira null)", async (_nome, value) => {
    const dto = plainToInstance(UpdateOwnCompanyDto, { fantasyName: value });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.fantasyName).toBeNull();
  });

  it("aceita corpo vazio: nada muda", async () => {
    await expect(validate_({})).resolves.toEqual([]);
  });

  it("recusa nome com mais de 100 caracteres e aceita exatamente 100", async () => {
    await expect(validate_({ fantasyName: "a".repeat(101) })).resolves.toEqual([
      "fantasyName",
    ]);
    await expect(validate_({ fantasyName: "a".repeat(100) })).resolves.toEqual(
      [],
    );
  });

  it("recusa qualquer outro campo cadastral: são do SUPER_ADMIN", async () => {
    await expect(
      validate_({
        fantasyName: "Bem Estar",
        corporateReason: "Outra LTDA",
        document: "11222333000181",
        timezone: "UTC",
        isActive: false,
        subdomain: "outra",
        logoUrl: "https://x.com/l.png",
      }),
    ).resolves.toEqual([
      "corporateReason",
      "document",
      "timezone",
      "isActive",
      "subdomain",
      "logoUrl",
    ]);
  });
});
