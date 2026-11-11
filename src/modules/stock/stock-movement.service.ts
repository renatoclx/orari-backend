import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  PayableStatus,
  StockMovementType,
} from "../../../generated/prisma/enums";
import { Prisma } from "../../../generated/prisma/client";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyAccessService } from "../company-access/company-access.service";
import { PayableService } from "../payable/payable.service";
import { profitMarginOf } from "../product/product-pricing";
import { CreateStockMovementDto } from "./dto/create-stock-movement.dto";

const asDate = (value: string) => new Date(`${value}T00:00:00Z`);
// Limite da descrição da conta a pagar.
const DESCRIPTION_MAX = 120;

const movementSelect = {
  id: true,
  type: true,
  quantity: true,
  balanceAfter: true,
  unitCost: true,
  note: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
  payable: { select: { id: true, description: true, status: true } },
} satisfies Prisma.StockMovementSelect;

export type StockMovementItem = Prisma.StockMovementGetPayload<{
  select: typeof movementSelect;
}>;

// Saídas lançadas à mão.
const EXITS: StockMovementType[] = [
  StockMovementType.INTERNAL_USE,
  StockMovementType.LOSS,
];

/**
 * Movimentações de estoque (ver docs/business-rules/categorias-produtos.md):
 * o estoque atual do produto é o saldo delas. Cada lançamento grava a
 * movimentação e o novo saldo juntos; o saldo nunca fica negativo.
 */
@Injectable()
export class StockMovementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payableService: PayableService,
    private readonly companyAccessService: CompanyAccessService,
  ) {}

  async create(
    productId: string,
    dto: CreateStockMovementDto,
    companyId: string,
    userId: string,
    now = new Date(),
  ): Promise<StockMovementItem> {
    const product = await this.findProduct(productId, companyId);
    const isPurchase = dto.type === StockMovementType.PURCHASE;

    if (!isPurchase && (dto.unitCost !== undefined || dto.payable)) {
      throw new BadRequestException(
        "Custo e conta a pagar só valem na entrada por compra",
      );
    }

    // Entrada e saídas mexem pela quantidade; o ajuste define o saldo.
    let delta: number;
    if (dto.type === StockMovementType.ADJUSTMENT) {
      delta = dto.quantity - product.currentStock;
      if (delta === 0) {
        throw new BadRequestException(
          "O saldo contado é igual ao estoque atual",
        );
      }
    } else {
      if (dto.quantity < 1) {
        throw new BadRequestException("Informe uma quantidade de 1 ou mais");
      }
      delta = EXITS.includes(dto.type) ? -dto.quantity : dto.quantity;
    }
    const balanceAfter = product.currentStock + delta;
    if (balanceAfter < 0) {
      throw new ConflictException(
        `Estoque insuficiente: há ${product.currentStock} em estoque`,
      );
    }

    const payable = dto.payable;
    const payeeId =
      payable?.payeeId === undefined ? product.supplierId : payable.payeeId;
    if (payable) {
      // A conta segue as regras do Contas a pagar, que precisa estar no plano.
      if (
        !(await this.companyAccessService.can(companyId, "payables", "create"))
      ) {
        throw new ForbiddenException(
          "Lançar a conta a pagar exige o Contas a pagar disponível para a sua empresa",
        );
      }
      await this.payableService.ensureNewPayable(
        { payeeId, categoryId: payable.categoryId, paid: payable.paid },
        companyId,
        now,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Só grava se o saldo não mudou desde a leitura: duas saídas ao mesmo
      // tempo não passam juntas do que há em estoque.
      const unitCost = isPurchase ? new Decimal(dto.unitCost!) : null;
      const { count } = await tx.product.updateMany({
        where: { id: product.id, currentStock: product.currentStock },
        data: {
          currentStock: balanceAfter,
          // Último custo: a compra passa a ser o preço de custo do produto.
          ...(unitCost && {
            purchasePrice: unitCost,
            profitMargin: profitMarginOf(product.salePrice, unitCost),
          }),
          updatedAt: now,
        },
      });
      if (count === 0) {
        throw new ConflictException(
          "O estoque do produto mudou enquanto você lançava. Confira e tente de novo",
        );
      }

      const created = payable
        ? await tx.payable.create({
            data: {
              companyId,
              description: `Compra: ${product.name} (${dto.quantity})`.slice(
                0,
                DESCRIPTION_MAX,
              ),
              payeeId: payeeId ?? null,
              categoryId: payable.categoryId,
              amount: unitCost!.mul(dto.quantity),
              dueDate: asDate(payable.dueDate),
              createdById: userId,
              ...(payable.paid && {
                status: PayableStatus.PAID,
                paidAt: asDate(payable.paid.paidAt),
                paymentMethodId: payable.paid.paymentMethodId,
              }),
            },
            select: { id: true },
          })
        : null;

      return tx.stockMovement.create({
        data: {
          companyId,
          productId: product.id,
          type: dto.type,
          quantity: delta,
          balanceAfter,
          unitCost,
          note: dto.note?.trim() || null,
          createdById: userId,
          payableId: created?.id ?? null,
        },
        select: movementSelect,
      });
    });
  }

  /** Histórico do produto, da mais recente para a mais antiga. */
  async findAll(
    productId: string,
    { page, limit }: PaginationQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<StockMovementItem>> {
    await this.findProduct(productId, companyId);
    const where = { productId, companyId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        select: movementSelect,
        // O id desempata movimentações do mesmo instante.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  // Produto da empresa, não excluído (os demais se comportam como inexistentes).
  private async findProduct(id: string, companyId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId, deletedAt: null },
      select: {
        id: true,
        name: true,
        currentStock: true,
        salePrice: true,
        supplierId: true,
      },
    });
    if (!product) {
      throw new NotFoundException("Produto não encontrado");
    }
    return product;
  }
}
