import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PaymentMethod, Prisma } from "../../../generated/prisma/client";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { CreatePaymentMethodDto } from "./dto/create-payment-method.dto";
import { FindPaymentMethodsQueryDto } from "./dto/find-payment-methods-query.dto";
import { UpdatePaymentMethodDto } from "./dto/update-payment-method.dto";

export type PublicPaymentMethod = Omit<PaymentMethod, "normalizedName">;

// A coluna normalizedName existe só para a busca e não faz parte das respostas.
const omitSearchColumn = { normalizedName: true } as const;

/**
 * Métodos de pagamento pertencem à empresa do usuário autenticado; os de outras
 * empresas se comportam como inexistentes (404). O nome é único entre os métodos
 * não excluídos da mesma empresa.
 */
@Injectable()
export class PaymentMethodService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreatePaymentMethodDto,
    companyId: string,
  ): Promise<PublicPaymentMethod> {
    try {
      return await this.prisma.paymentMethod.create({
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
    { page, limit, name }: FindPaymentMethodsQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<PublicPaymentMethod>> {
    const where: Prisma.PaymentMethodWhereInput = {
      companyId,
      deletedAt: null,
      normalizedName: name ? { contains: normalizeForSearch(name) } : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.paymentMethod.findMany({
        where,
        omit: omitSearchColumn,
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.paymentMethod.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, companyId: string): Promise<PublicPaymentMethod> {
    const paymentMethod = await this.prisma.paymentMethod.findFirst({
      where: { id, companyId, deletedAt: null },
      omit: omitSearchColumn,
    });

    if (!paymentMethod) {
      throw new NotFoundException("Método de pagamento não encontrado");
    }

    return paymentMethod;
  }

  async update(
    id: string,
    dto: UpdatePaymentMethodDto,
    companyId: string,
  ): Promise<PublicPaymentMethod> {
    await this.findOne(id, companyId);

    try {
      return await this.prisma.paymentMethod.update({
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

  async remove(id: string, companyId: string): Promise<void> {
    await this.findOne(id, companyId);

    const now = new Date();
    await this.prisma.paymentMethod.update({
      where: { id },
      data: { deletedAt: now, updatedAt: now },
    });
  }

  private mapUniqueViolation(error: unknown): unknown {
    return isUniqueConstraintViolation(error)
      ? new ConflictException(
          "Já existe um método de pagamento com este nome na empresa",
        )
      : error;
  }
}
