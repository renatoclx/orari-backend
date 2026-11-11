import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  PaymentStatus,
  PeopleType,
  StockMovementType,
} from "../../../generated/prisma/enums";
import { Prisma } from "../../../generated/prisma/client";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { localToday } from "../receivables/receivables.service";
import { CreateProductSaleDto } from "./dto/create-product-sale.dto";

// Produtos que a busca da comanda mostra de cada vez.
const SEARCH_LIMIT = 20;

const saleProductSelect = {
  id: true,
  name: true,
  sku: true,
  photoUrl: true,
  measureUnit: true,
  salePrice: true,
  promotionalPrice: true,
  currentStock: true,
} satisfies Prisma.ProductSelect;

export type SaleProduct = Prisma.ProductGetPayload<{
  select: typeof saleProductSelect;
}>;

/** A venda como a comanda a mostra: itens, total e o pagamento. */
export const saleDetailSelect = {
  id: true,
  clientId: true,
  createdAt: true,
  cancelledAt: true,
  createdBy: { select: { id: true, name: true } },
  items: {
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      product: { select: { id: true, name: true } },
    },
    orderBy: { id: "asc" },
  },
  payment: {
    select: {
      id: true,
      amount: true,
      dueDate: true,
      status: true,
      paidAt: true,
      paymentMethod: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ProductSaleSelect;

export type ProductSaleDetail = Prisma.ProductSaleGetPayload<{
  select: typeof saleDetailSelect;
}>;

/**
 * Venda de produtos na comanda (ver docs/business-rules/categorias-produtos.md).
 * Cada venda tira os produtos do estoque e nasce com um pagamento pendente,
 * recebido pela baixa da comanda. Só a venda pendente é cancelada: o pagamento
 * é cancelado e os produtos voltam ao estoque.
 */
@Injectable()
export class ProductSaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
  ) {}

  /** Produtos ativos para vender, por nome ou SKU, com preço e estoque. */
  findProducts(
    search: string | undefined,
    companyId: string,
  ): Promise<SaleProduct[]> {
    return this.prisma.product.findMany({
      where: {
        companyId,
        deletedAt: null,
        isActive: true,
        OR: search
          ? [
              { normalizedName: { contains: normalizeForSearch(search) } },
              { sku: { contains: search, mode: "insensitive" } },
            ]
          : undefined,
      },
      select: saleProductSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: SEARCH_LIMIT,
    });
  }

  async create(
    dto: CreateProductSaleDto,
    companyId: string,
    userId: string,
    now = new Date(),
  ): Promise<ProductSaleDetail> {
    const productIds = dto.items.map((item) => item.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException(
        "O mesmo produto aparece duas vezes: junte as quantidades",
      );
    }
    await this.ensureClient(dto.clientId, companyId);

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId, deletedAt: null },
      select: { id: true, name: true, isActive: true },
    });
    if (products.length !== productIds.length) {
      throw new NotFoundException("Produto não encontrado");
    }
    const inactive = products.find((product) => !product.isActive);
    if (inactive) {
      throw new BadRequestException(`O produto ${inactive.name} está inativo`);
    }
    const nameOf = new Map(
      products.map((product) => [product.id, product.name]),
    );

    // Vencimento: hoje no calendário da empresa.
    const today = localToday(
      now,
      await this.companyService.getTimeZone(companyId),
    );
    const total = dto.items.reduce(
      (sum, item) => sum.plus(new Decimal(item.unitPrice).mul(item.quantity)),
      new Decimal(0),
    );

    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.productSale.create({
        data: {
          companyId,
          clientId: dto.clientId,
          createdById: userId,
          items: {
            create: dto.items.map(({ productId, quantity, unitPrice }) => ({
              productId,
              quantity,
              unitPrice,
            })),
          },
        },
        select: { id: true },
      });

      for (const item of dto.items) {
        // Só tira se houver: duas vendas ao mesmo tempo não passam do estoque.
        const { count } = await tx.product.updateMany({
          where: { id: item.productId, currentStock: { gte: item.quantity } },
          data: {
            currentStock: { decrement: item.quantity },
            updatedAt: now,
          },
        });
        const { currentStock } = await tx.product.findUniqueOrThrow({
          where: { id: item.productId },
          select: { currentStock: true },
        });
        if (count === 0) {
          throw new ConflictException(
            `Estoque insuficiente de ${nameOf.get(item.productId)}: há ${currentStock} em estoque`,
          );
        }
        await tx.stockMovement.create({
          data: {
            companyId,
            productId: item.productId,
            type: StockMovementType.SALE,
            quantity: -item.quantity,
            balanceAfter: currentStock,
            createdById: userId,
            productSaleId: sale.id,
          },
        });
      }

      await tx.payment.create({
        data: {
          companyId,
          productSaleId: sale.id,
          amount: total,
          dueDate: today,
          status: PaymentStatus.PENDING,
        },
      });

      return tx.productSale.findUniqueOrThrow({
        where: { id: sale.id },
        select: saleDetailSelect,
      });
    });
  }

  /**
   * Cancela a venda pendente: o pagamento fica cancelado e cada produto volta
   * ao estoque (uma movimentação "venda cancelada" por item).
   */
  async cancel(
    id: string,
    companyId: string,
    userId: string,
    now = new Date(),
  ): Promise<ProductSaleDetail> {
    const sale = await this.prisma.productSale.findFirst({
      where: { id, companyId },
      select: {
        cancelledAt: true,
        items: { select: { productId: true, quantity: true } },
        payment: { select: { id: true, status: true } },
      },
    });
    if (!sale) {
      throw new NotFoundException("Venda não encontrada");
    }
    if (sale.cancelledAt) {
      throw new ConflictException("A venda já foi cancelada");
    }
    if (sale.payment?.status === PaymentStatus.PAID) {
      throw new ConflictException("Venda já recebida não pode ser cancelada");
    }

    return this.prisma.$transaction(async (tx) => {
      // O status no filtro protege de uma baixa entre a leitura e a gravação.
      const { count } = await tx.payment.updateMany({
        where: {
          productSaleId: id,
          status: PaymentStatus.PENDING,
          deletedAt: null,
        },
        data: { status: PaymentStatus.CANCELLED, updatedAt: now },
      });
      if (count === 0) {
        throw new ConflictException("Venda já recebida não pode ser cancelada");
      }

      for (const item of sale.items) {
        const { currentStock } = await tx.product.update({
          where: { id: item.productId },
          data: {
            currentStock: { increment: item.quantity },
            updatedAt: now,
          },
          select: { currentStock: true },
        });
        await tx.stockMovement.create({
          data: {
            companyId,
            productId: item.productId,
            type: StockMovementType.SALE_CANCELLED,
            quantity: item.quantity,
            balanceAfter: currentStock,
            createdById: userId,
            productSaleId: id,
          },
        });
      }

      return tx.productSale.update({
        where: { id },
        data: { cancelledAt: now, cancelledById: userId },
        select: saleDetailSelect,
      });
    });
  }

  // O cliente é uma pessoa ativa da empresa, do tipo CLIENT.
  private async ensureClient(clientId: string, companyId: string) {
    const client = await this.prisma.people.findFirst({
      where: {
        id: clientId,
        companyId,
        deletedAt: null,
        type: PeopleType.CLIENT,
      },
      select: { id: true },
    });
    if (!client) {
      throw new BadRequestException("O cliente precisa ser um cliente ativo");
    }
  }
}
