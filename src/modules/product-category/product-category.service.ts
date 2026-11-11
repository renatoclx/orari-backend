import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, ProductCategory } from "../../../generated/prisma/client";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateProductCategoryDto } from "./dto/create-product-category.dto";
import { FindProductCategoriesQueryDto } from "./dto/find-product-categories-query.dto";
import { UpdateProductCategoryDto } from "./dto/update-product-category.dto";

export type PublicProductCategory = Omit<ProductCategory, "normalizedName">;

// A coluna normalizedName existe só para a busca e a unicidade; não faz parte das respostas.
const omitSearchColumn = { normalizedName: true } as const;

/**
 * Categorias de produto (ver docs/business-rules/categorias-produtos.md)
 * pertencem à empresa do usuário; as de outras empresas se comportam como
 * inexistentes (404). O nome é único na empresa, sem diferenciar maiúsculas
 * nem acentos (o índice único usa o normalizedName). Não há exclusão: a
 * categoria é inativada pela alteração.
 */
@Injectable()
export class ProductCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateProductCategoryDto,
    companyId: string,
  ): Promise<PublicProductCategory> {
    try {
      return await this.prisma.productCategory.create({
        data: {
          ...dto,
          normalizedName: normalizeForSearch(dto.name),
          companyId,
        },
        omit: omitSearchColumn,
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async findAll(
    { page, limit, name, isActive }: FindProductCategoriesQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<PublicProductCategory>> {
    const where: Prisma.ProductCategoryWhereInput = {
      companyId,
      isActive,
      normalizedName: name ? { contains: normalizeForSearch(name) } : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.productCategory.findMany({
        where,
        omit: omitSearchColumn,
        // O id desempata nomes iguais na paginação.
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productCategory.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, companyId: string): Promise<PublicProductCategory> {
    const category = await this.prisma.productCategory.findFirst({
      where: { id, companyId },
      omit: omitSearchColumn,
    });

    if (!category) {
      throw new NotFoundException("Categoria de produto não encontrada");
    }

    return category;
  }

  /**
   * Para o cadastro do produto: a categoria precisa ser da empresa (404) e
   * estar ativa (400). Um produto não entra numa categoria inativa.
   */
  async ensureActive(id: string, companyId: string): Promise<void> {
    const category = await this.findOne(id, companyId);
    if (!category.isActive) {
      throw new BadRequestException("A categoria de produto está inativa");
    }
  }

  async update(
    id: string,
    dto: UpdateProductCategoryDto,
    companyId: string,
  ): Promise<PublicProductCategory> {
    const current = await this.findOne(id, companyId);
    if (dto.isActive === false && current.isActive) {
      await this.ensureHasNoActiveProducts(id);
    }

    try {
      return await this.prisma.productCategory.update({
        where: { id },
        data: {
          ...dto,
          // Mantém a coluna de busca em sincronia sempre que o nome muda.
          ...(dto.name !== undefined && {
            normalizedName: normalizeForSearch(dto.name),
          }),
          updatedAt: new Date(),
        },
        omit: omitSearchColumn,
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  /**
   * Uma categoria com produtos ativos não é inativada: eles ficariam numa
   * categoria que não pode mais receber produtos. Leitura direta da tabela de
   * produtos: o ProductModule depende deste módulo, e o caminho inverso
   * criaria um ciclo.
   */
  private async ensureHasNoActiveProducts(categoryId: string): Promise<void> {
    const activeProducts = await this.prisma.product.count({
      where: { categoryId, isActive: true, deletedAt: null },
    });

    if (activeProducts > 0) {
      throw new ConflictException(
        "A categoria tem produtos ativos. Inative os produtos ou mude a categoria deles antes de inativá-la.",
      );
    }
  }

  private mapUniqueViolation(error: unknown): unknown {
    return isUniqueConstraintViolation(error)
      ? new ConflictException(
          "Já existe uma categoria de produto com este nome na empresa",
        )
      : error;
  }
}
