// @Type (class-transformer) depende do reflect-metadata, que em runtime é carregado pelo Nest.
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateCompanyDto } from "./create-company.dto";
import { FindCompaniesQueryDto } from "./find-companies-query.dto";

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
