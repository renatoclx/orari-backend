import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, Service } from "../../../generated/prisma/client";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateServiceDto } from "./dto/create-service.dto";
import { FindServicesQueryDto } from "./dto/find-services-query.dto";
import { UpdateServiceDto } from "./dto/update-service.dto";

export type PublicService = Omit<Service, "normalizedName">;

// A coluna normalizedName existe só para a busca e não faz parte das respostas.
const omitSearchColumn = { normalizedName: true } as const;

/**
 * Serviços pertencem à empresa do usuário autenticado; os de outras empresas se
 * comportam como inexistentes (404). O nome é único entre os serviços não
 * excluídos da mesma empresa.
 */
@Injectable()
export class ServiceService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateServiceDto,
    companyId: string,
  ): Promise<PublicService> {
    try {
      return await this.prisma.service.create({
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
    { page, limit, name, isActive }: FindServicesQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<PublicService>> {
    const where: Prisma.ServiceWhereInput = {
      companyId,
      deletedAt: null,
      isActive,
      normalizedName: name ? { contains: normalizeForSearch(name) } : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.service.findMany({
        where,
        omit: omitSearchColumn,
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.service.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, companyId: string): Promise<PublicService> {
    const service = await this.prisma.service.findFirst({
      where: { id, companyId, deletedAt: null },
      omit: omitSearchColumn,
    });

    if (!service) {
      throw new NotFoundException("Serviço não encontrado");
    }

    return service;
  }

  /**
   * Usado pelos agendamentos: além de existir, o serviço precisa estar ativo,
   * porque é dele que sai a duração do atendimento.
   */
  async findActive(id: string, companyId: string): Promise<PublicService> {
    const service = await this.findOne(id, companyId);

    if (!service.isActive) {
      throw new ConflictException("Serviço inativo");
    }

    return service;
  }

  async update(
    id: string,
    dto: UpdateServiceDto,
    companyId: string,
  ): Promise<PublicService> {
    await this.findOne(id, companyId);

    try {
      return await this.prisma.service.update({
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
    await this.prisma.service.update({
      where: { id },
      data: { deletedAt: now, updatedAt: now },
    });
  }

  private mapUniqueViolation(error: unknown): unknown {
    return isUniqueConstraintViolation(error)
      ? new ConflictException("Já existe um serviço com este nome na empresa")
      : error;
  }
}
