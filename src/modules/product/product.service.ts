import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PeopleType } from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { detectImageExtension } from "../../common/storage/image-type";
import { LocalFileStorage } from "../../common/storage/local-file-storage.service";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { PeopleService } from "../people/people.service";
import { ProductCategoryService } from "../product-category/product-category.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { FindProductsQueryDto } from "./dto/find-products-query.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { profitMarginOf } from "./product-pricing";

const PHOTO_FOLDER = "products";

// Categoria e fornecedor vêm junto; a coluna de busca fica de fora.
const withDetails = {
  omit: { normalizedName: true },
  include: {
    category: { select: { id: true, name: true } },
    supplier: { select: { id: true, name: true } },
  },
} satisfies Prisma.ProductDefaultArgs;

export type ProductResponse = Prisma.ProductGetPayload<typeof withDetails>;

// Preços e estoque como ficarão gravados, para conferir as regras entre eles.
interface PricesAndStock {
  salePrice: Decimal | number;
  purchasePrice: Decimal | number;
  promotionalPrice: Decimal | number | null;
  minimalStock: number | null;
  maximumStock: number | null;
}

/**
 * Produtos (ver docs/business-rules/categorias-produtos.md) pertencem à empresa
 * do usuário; os de outras empresas e os excluídos se comportam como
 * inexistentes (404). A margem de lucro é calculada aqui, a cada mudança de
 * preço, e nunca vem do payload.
 */
@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productCategoryService: ProductCategoryService,
    private readonly peopleService: PeopleService,
    private readonly storage: LocalFileStorage,
  ) {}

  async create(
    dto: CreateProductDto,
    companyId: string,
  ): Promise<ProductResponse> {
    this.ensurePricesAndStock({
      salePrice: dto.salePrice,
      purchasePrice: dto.purchasePrice,
      promotionalPrice: dto.promotionalPrice ?? null,
      minimalStock: dto.minimalStock ?? null,
      maximumStock: dto.maximumStock ?? null,
    });
    await this.productCategoryService.ensureActive(dto.categoryId, companyId);
    if (dto.supplierId) {
      await this.ensureSupplier(dto.supplierId, companyId);
    }

    try {
      return await this.prisma.product.create({
        data: {
          ...dto,
          normalizedName: normalizeForSearch(dto.name),
          profitMargin: profitMarginOf(dto.salePrice, dto.purchasePrice),
          companyId,
        },
        ...withDetails,
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async findAll(
    {
      page,
      limit,
      search,
      categoryId,
      supplierId,
      isActive,
    }: FindProductsQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<ProductResponse>> {
    const where: Prisma.ProductWhereInput = {
      companyId,
      deletedAt: null,
      categoryId,
      supplierId,
      isActive,
      OR: search
        ? [
            { normalizedName: { contains: normalizeForSearch(search) } },
            { sku: { contains: search, mode: "insensitive" } },
          ]
        : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        ...withDetails,
        // O id desempata nomes iguais na paginação.
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, companyId: string): Promise<ProductResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId, deletedAt: null },
      ...withDetails,
    });

    if (!product) {
      throw new NotFoundException("Produto não encontrado");
    }

    return product;
  }

  /**
   * O que não vier no payload continua como está. As regras entre campos
   * (promocional abaixo da venda, mínimo até o máximo) são conferidas com os
   * valores finais, e a margem é recalculada com eles.
   */
  async update(
    id: string,
    dto: UpdateProductDto,
    companyId: string,
  ): Promise<ProductResponse> {
    const current = await this.findOne(id, companyId);

    const salePrice = dto.salePrice ?? current.salePrice;
    const purchasePrice = dto.purchasePrice ?? current.purchasePrice;
    this.ensurePricesAndStock({
      salePrice,
      purchasePrice,
      promotionalPrice:
        dto.promotionalPrice !== undefined
          ? dto.promotionalPrice
          : current.promotionalPrice,
      minimalStock:
        dto.minimalStock !== undefined
          ? dto.minimalStock
          : current.minimalStock,
      maximumStock:
        dto.maximumStock !== undefined
          ? dto.maximumStock
          : current.maximumStock,
    });

    // A categoria precisa estar ativa ao trocá-la e ao reativar o produto.
    const changesCategory =
      dto.categoryId !== undefined && dto.categoryId !== current.categoryId;
    const reactivates = dto.isActive === true && !current.isActive;
    if (changesCategory || reactivates) {
      await this.productCategoryService.ensureActive(
        dto.categoryId ?? current.categoryId,
        companyId,
      );
    }
    if (dto.supplierId) {
      await this.ensureSupplier(dto.supplierId, companyId);
    }

    try {
      return await this.prisma.product.update({
        where: { id },
        data: {
          ...dto,
          // Mantém a coluna de busca em sincronia sempre que o nome muda.
          ...(dto.name !== undefined && {
            normalizedName: normalizeForSearch(dto.name),
          }),
          profitMargin: profitMarginOf(salePrice, purchasePrice),
          updatedAt: new Date(),
        },
        ...withDetails,
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  // Exclusão lógica: o produto some das listagens e o SKU dele fica livre.
  async remove(id: string, companyId: string): Promise<void> {
    await this.findOne(id, companyId);

    const now = new Date();
    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: now, updatedAt: now },
    });
  }

  /**
   * Grava a foto e substitui a anterior. O formato é conferido pelo conteúdo
   * (JPEG ou PNG); o tamanho já foi limitado no upload. O arquivo antigo só é
   * apagado depois que o banco aponta para o novo.
   */
  async updatePhoto(
    id: string,
    content: Buffer,
    companyId: string,
  ): Promise<ProductResponse> {
    const product = await this.findOne(id, companyId);

    const extension = detectImageExtension(content);
    if (!extension) {
      throw new BadRequestException("A foto deve ser uma imagem JPEG ou PNG");
    }

    const photoUrl = await this.storage.save(PHOTO_FOLDER, content, extension);
    const updated = await this.prisma.product.update({
      where: { id },
      data: { photoUrl, updatedAt: new Date() },
      ...withDetails,
    });

    if (product.photoUrl) {
      await this.storage.remove(product.photoUrl);
    }

    return updated;
  }

  // Remove a foto: limpa o caminho no banco e apaga o arquivo.
  async removePhoto(id: string, companyId: string): Promise<void> {
    const product = await this.findOne(id, companyId);
    if (!product.photoUrl) {
      return;
    }

    await this.prisma.product.update({
      where: { id },
      data: { photoUrl: null, updatedAt: new Date() },
    });
    await this.storage.remove(product.photoUrl);
  }

  // Promocional abaixo da venda; mínimo até o máximo (os dois só quando informados).
  private ensurePricesAndStock({
    salePrice,
    promotionalPrice,
    minimalStock,
    maximumStock,
  }: PricesAndStock): void {
    if (
      promotionalPrice !== null &&
      new Decimal(promotionalPrice).gte(salePrice)
    ) {
      throw new BadRequestException(
        "O preço promocional precisa ser menor que o preço de venda",
      );
    }

    if (
      minimalStock !== null &&
      maximumStock !== null &&
      minimalStock > maximumStock
    ) {
      throw new BadRequestException(
        "O estoque mínimo não pode passar do estoque máximo",
      );
    }
  }

  // O fornecedor é uma pessoa ativa da empresa, do tipo SUPPLIER.
  private async ensureSupplier(
    supplierId: string,
    companyId: string,
  ): Promise<void> {
    const supplier = await this.peopleService
      .findOne(supplierId, companyId)
      .catch((error: unknown) => {
        if (error instanceof NotFoundException) return null;
        throw error;
      });

    if (supplier?.type !== PeopleType.SUPPLIER) {
      throw new BadRequestException(
        "O fornecedor precisa ser uma pessoa ativa do tipo SUPPLIER",
      );
    }
  }

  private mapUniqueViolation(error: unknown): unknown {
    return isUniqueConstraintViolation(error)
      ? new ConflictException("Já existe um produto com este SKU na empresa")
      : error;
  }
}
