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
  cnpj: "12abc34501de35",
  foundationDate: "2020-01-15",
  subdomain: "empresa",
};

describe("CreateCompanyDto", () => {
  it("normaliza o CNPJ alfanumérico para maiúsculas antes de validar", async () => {
    const dto = plainToInstance(CreateCompanyDto, payload);

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.cnpj).toBe("12ABC34501DE35");
  });

  it("recusa CNPJ com dígito verificador inválido", async () => {
    const errors = await validate(
      plainToInstance(CreateCompanyDto, {
        ...payload,
        cnpj: "11222333000182",
      }),
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
        cnpj: "11222333000181",
        timezone: "UTC",
        isActive: false,
        subdomain: "outra",
        logoUrl: "https://x.com/l.png",
      }),
    ).resolves.toEqual([
      "corporateReason",
      "cnpj",
      "timezone",
      "isActive",
      "subdomain",
      "logoUrl",
    ]);
  });
});
