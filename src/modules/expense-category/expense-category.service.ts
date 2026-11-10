import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ExpenseCategory, Prisma } from "../../../generated/prisma/client";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateExpenseCategoryDto } from "./dto/create-expense-category.dto";
import { FindExpenseCategoriesQueryDto } from "./dto/find-expense-categories-query.dto";
import { UpdateExpenseCategoryDto } from "./dto/update-expense-category.dto";

/** Categorias com que toda empresa nasce (a migração deu as mesmas às existentes). */
export const DEFAULT_EXPENSE_CATEGORIES = [
  "Aluguel",
  "Energia",
  "Água",
  "Internet e telefone",
  "Produtos",
  "Comissões",
  "Salários",
  "Impostos",
  "Outros",
] as const;

export type PublicExpenseCategory = Omit<ExpenseCategory, "normalizedName">;

// A coluna normalizedName existe só para a busca e não faz parte das respostas.
const omitSearchColumn = { normalizedName: true } as const;

/**
 * Categorias de despesa (contas a pagar) pertencem à empresa do usuário; as de
 * outras empresas se comportam como inexistentes (404). O nome é único entre
 * as não excluídas da mesma empresa, sem diferenciar maiúsculas nem acentos (o
 * índice único usa o normalizedName).
 */
@Injectable()
export class ExpenseCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateExpenseCategoryDto,
    companyId: string,
  ): Promise<PublicExpenseCategory> {
    try {
      return await this.prisma.expenseCategory.create({
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
    { page, limit, name, isActive }: FindExpenseCategoriesQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<PublicExpenseCategory>> {
    const where: Prisma.ExpenseCategoryWhereInput = {
      companyId,
      // Sem filtro, ativas e inativas (para reativar); com filtro, só um dos dois.
      deletedAt:
        isActive === undefined ? undefined : isActive ? null : { not: null },
      normalizedName: name ? { contains: normalizeForSearch(name) } : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.expenseCategory.findMany({
        where,
        omit: omitSearchColumn,
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expenseCategory.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, companyId: string): Promise<PublicExpenseCategory> {
    const expenseCategory = await this.prisma.expenseCategory.findFirst({
      where: { id, companyId, deletedAt: null },
      omit: omitSearchColumn,
    });

    if (!expenseCategory) {
      throw new NotFoundException("Categoria de despesa não encontrada");
    }

    return expenseCategory;
  }

  async update(
    id: string,
    dto: UpdateExpenseCategoryDto,
    companyId: string,
  ): Promise<PublicExpenseCategory> {
    await this.findOne(id, companyId);

    try {
      return await this.prisma.expenseCategory.update({
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

  // Reativa uma categoria inativada (limpa o deletedAt).
  async restore(id: string, companyId: string): Promise<PublicExpenseCategory> {
    const expenseCategory = await this.prisma.expenseCategory.findFirst({
      where: { id, companyId },
      select: { deletedAt: true },
    });

    if (!expenseCategory) {
      throw new NotFoundException("Categoria de despesa não encontrada");
    }
    if (!expenseCategory.deletedAt) {
      throw new ConflictException("A categoria de despesa já está ativa");
    }

    try {
      return await this.prisma.expenseCategory.update({
        where: { id },
        data: { deletedAt: null, updatedAt: new Date() },
        omit: omitSearchColumn,
      });
    } catch (error) {
      // O nome é único só entre as ativas: outra categoria pode ter assumido o dela.
      throw isUniqueConstraintViolation(error)
        ? new ConflictException(
            "Não é possível reativar: já existe uma categoria de despesa ativa com este nome",
          )
        : error;
    }
  }

  async remove(id: string, companyId: string): Promise<void> {
    await this.findOne(id, companyId);

    const now = new Date();
    await this.prisma.expenseCategory.update({
      where: { id },
      data: { deletedAt: now, updatedAt: now },
    });
  }

  private mapUniqueViolation(error: unknown): unknown {
    return isUniqueConstraintViolation(error)
      ? new ConflictException(
          "Já existe uma categoria de despesa com este nome na empresa",
        )
      : error;
  }
}
