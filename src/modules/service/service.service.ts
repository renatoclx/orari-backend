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
    const current = await this.findOne(id, companyId);
    if (dto.allowsClasses === false && current.allowsClasses) {
      await this.ensureHasNoActiveClassGroups(id);
    }

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

  /**
   * Só exclui serviço sem nenhum relacionamento. Contam todos os registros, até
   * os cancelados ou encerrados: o histórico precisa continuar apontando para o
   * serviço. Com relacionamento, o caminho é inativar (PATCH com isActive false).
   *
   * Plano não tem exclusão (só isActive) e seus itens saem da tabela quando o
   * plano é editado: por isso todo PlanItem existente é um vínculo real.
   */
  async remove(id: string, companyId: string): Promise<void> {
    await this.findOne(id, companyId);
    await this.ensureHasNoRelationships(id);

    const now = new Date();
    await this.prisma.service.update({
      where: { id },
      data: { deletedAt: now, updatedAt: now },
    });
  }

  // A leitura é por contagem de relações: não depende dos services de outros módulos.
  private async ensureHasNoRelationships(id: string): Promise<void> {
    const { _count: related } = await this.prisma.service.findUniqueOrThrow({
      where: { id },
      select: {
        _count: {
          select: {
            appointments: true,
            recurringAppointments: true,
            planItems: true,
            classGroups: true,
          },
        },
      },
    });

    if (
      related.appointments +
        related.recurringAppointments +
        related.planItems +
        related.classGroups >
      0
    ) {
      throw new ConflictException(
        "O serviço possui agendamentos, recorrências, planos ou turmas vinculados. Inative-o em vez de excluir.",
      );
    }
  }

  // Deixar de aceitar turma com turma ativa deixaria a turma sem serviço válido.
  private async ensureHasNoActiveClassGroups(id: string): Promise<void> {
    const activeClassGroups = await this.prisma.classGroup.count({
      where: { serviceId: id, isActive: true },
    });

    if (activeClassGroups > 0) {
      throw new ConflictException(
        "O serviço possui turmas ativas. Inative as turmas antes de deixar de aceitar turma.",
      );
    }
  }

  private mapUniqueViolation(error: unknown): unknown {
    return isUniqueConstraintViolation(error)
      ? new ConflictException("Já existe um serviço com este nome na empresa")
      : error;
  }
}
