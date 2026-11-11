// @Type (class-transformer) depende do reflect-metadata, que em runtime é carregado pelo Nest.
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { UpdateProductCategoryDto } from "../../product-category/dto/update-product-category.dto";
import { CreateProductDto } from "./create-product.dto";
import { FindProductsQueryDto } from "./find-products-query.dto";
import { UpdateProductDto } from "./update-product.dto";

const uuid = "11111111-1111-4111-8111-111111111111";
const base = {
  name: "Óleo",
  categoryId: uuid,
  salePrice: 100,
  purchasePrice: 60,
  currentStock: 0,
};

async function errorsFor(
  payload: object,
  dto: new () => object = CreateProductDto,
) {
  const errors = await validate(plainToInstance(dto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe("CreateProductDto", () => {
  it("aceita o produto mínimo e o completo", async () => {
    await expect(errorsFor(base)).resolves.toEqual([]);
    await expect(
      errorsFor({
        ...base,
        description: "x",
        sku: "OL-01",
        supplierId: uuid,
        measureUnit: "ML",
        promotionalPrice: 90.5,
        minimalStock: 1,
        maximumStock: 20,
        isActive: false,
      }),
    ).resolves.toEqual([]);
  });

  it.each([
    ["sem preço de venda", { salePrice: undefined }, "salePrice"],
    ["custo zero", { purchasePrice: 0 }, "purchasePrice"],
    ["preço com três casas", { salePrice: 10.123 }, "salePrice"],
    ["estoque fracionado", { currentStock: 1.5 }, "currentStock"],
    ["estoque negativo", { currentStock: -1 }, "currentStock"],
    ["unidade fora da lista", { measureUnit: "LATA" }, "measureUnit"],
    ["categoria que não é UUID", { categoryId: "x" }, "categoryId"],
    ["margem no payload", { profitMargin: 40 }, "profitMargin"],
    ["empresa no payload", { companyId: uuid }, "companyId"],
  ])("recusa %s", async (_, override, property) => {
    await expect(errorsFor({ ...base, ...override })).resolves.toEqual([
      property,
    ]);
  });
});

describe("UpdateProductDto", () => {
  it("aceita alteração parcial e null nos campos opcionais", async () => {
    await expect(
      errorsFor(
        {
          salePrice: 120,
          sku: null,
          supplierId: null,
          measureUnit: null,
          promotionalPrice: null,
          minimalStock: null,
          maximumStock: null,
          description: null,
        },
        UpdateProductDto,
      ),
    ).resolves.toEqual([]);
  });

  it.each([
    ["name"],
    ["categoryId"],
    ["salePrice"],
    ["purchasePrice"],
    ["currentStock"],
    ["isActive"],
  ])("recusa %s nulo (é obrigatório)", async (property) => {
    await expect(
      errorsFor({ [property]: null }, UpdateProductDto),
    ).resolves.toEqual([property]);
  });
});

describe("UpdateProductCategoryDto", () => {
  it("aceita nome e situação, e recusa o nome nulo", async () => {
    await expect(
      errorsFor({ name: "Novo", isActive: false }, UpdateProductCategoryDto),
    ).resolves.toEqual([]);
    await expect(
      errorsFor({ name: null }, UpdateProductCategoryDto),
    ).resolves.toEqual(["name"]);
  });
});

describe("FindProductsQueryDto", () => {
  it("converte o booleano da query string", async () => {
    const query = plainToInstance(FindProductsQueryDto, { isActive: "false" });

    await expect(validate(query)).resolves.toEqual([]);
    expect(query.isActive).toBe(false);
  });
});
