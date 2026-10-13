import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { ServiceService } from "../service/service.service";
import { CreatePlanDto } from "./dto/create-plan.dto";
import { FindPlansQueryDto } from "./dto/find-plans-query.dto";
import { PlanPeriodDto } from "./dto/plan-period.dto";
import { UpdatePlanDto } from "./dto/update-plan.dto";

// Serviços e períodos vêm junto com o plano; a coluna de busca fica de fora.
const withDetails = {
  omit: { normalizedName: true },
  include: {
    items: {
      select: {
        service: { select: { id: true, name: true, isActive: true } },
      },
      orderBy: { service: { name: "asc" } },
    },
    periods: {
      select: {
        months: true,
        discountPercent: true,
        monthlyDiscountPercent: true,
      },
      orderBy: { months: "asc" },
    },
  },
} satisfies Prisma.PlanDefaultArgs;

type PlanWithDetails = Prisma.PlanGetPayload<typeof withDetails>;

// O item do plano é devolvido como o próprio serviço: quem consome não precisa
// conhecer a tabela intermediária.
export type PlanResponse = Omit<PlanWithDetails, "items"> & {
  services: PlanWithDetails["items"][number]["service"][];
};

/**
 * Planos pertencem à empresa do usuário autenticado; os de outras empresas se
 * comportam como inexistentes (404). O nome é único na empresa.
 *
 * Itens (serviços) e períodos fazem parte do plano: são gravados junto com ele
 * e substituídos em bloco, como os dias de uma recorrência. Contratações não
 * dependem deles, porque guardam cópia dos valores.
 *
 * Não existe exclusão: o plano é desativado por isActive.
 */
@Injectable()
export class PlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serviceService: ServiceService,
  ) {}

  async create(dto: CreatePlanDto, companyId: string): Promise<PlanResponse> {
    const { serviceIds, periods = [], ...data } = dto;

    await this.ensureServicesAreActive(serviceIds, companyId);
    this.ensurePeriodsAreUnique(periods);

    try {
      const plan = await this.prisma.plan.create({
        data: {
          ...data,
          normalizedName: normalizeForSearch(dto.name),
          companyId,
          items: { create: this.toItemRows(serviceIds) },
          periods: { create: periods },
        },
        ...withDetails,
      });

      return this.toResponse(plan);
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async findAll(
    { page, limit, name, isActive }: FindPlansQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<PlanResponse>> {
    const where: Prisma.PlanWhereInput = {
      companyId,
      isActive,
      normalizedName: name ? { contains: normalizeForSearch(name) } : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.plan.findMany({
        where,
        ...withDetails,
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.plan.count({ where }),
    ]);

    return {
      items: items.map((plan) => this.toResponse(plan)),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string, companyId: string): Promise<PlanResponse> {
    const plan = await this.prisma.plan.findFirst({
      where: { id, companyId },
      ...withDetails,
    });

    if (!plan) {
      throw new NotFoundException("Plano não encontrado");
    }

    return this.toResponse(plan);
  }

  async update(
    id: string,
    dto: UpdatePlanDto,
    companyId: string,
  ): Promise<PlanResponse> {
    await this.findOne(id, companyId);
    const { serviceIds, periods, ...data } = dto;

    if (serviceIds) {
      await this.ensureServicesAreActive(serviceIds, companyId);
    }
    if (periods) {
      this.ensurePeriodsAreUnique(periods);
    }

    try {
      // Apagar e recriar as listas no mesmo update é atômico: o plano nunca
      // fica sem serviços caso algo falhe no meio.
      const plan = await this.prisma.plan.update({
        where: { id },
        data: {
          ...data,
          // Mantém a coluna de busca em sincronia sempre que o nome muda.
          ...(data.name !== undefined && {
            normalizedName: normalizeForSearch(data.name),
          }),
          ...(serviceIds && {
            items: { deleteMany: {}, create: this.toItemRows(serviceIds) },
          }),
          ...(periods && { periods: { deleteMany: {}, create: periods } }),
          updatedAt: new Date(),
        },
        ...withDetails,
      });

      return this.toResponse(plan);
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  // Cada serviço precisa ser da empresa (404) e estar ativo (409) no cadastro e na edição.
  private async ensureServicesAreActive(
    serviceIds: string[],
    companyId: string,
  ) {
    for (const serviceId of serviceIds) {
      await this.serviceService.findActive(serviceId, companyId);
    }
  }

  // O mesmo número de meses não pode ter dois descontos diferentes no plano.
  private ensurePeriodsAreUnique(periods: PlanPeriodDto[]) {
    const months = periods.map((period) => period.months);

    if (new Set(months).size !== months.length) {
      throw new BadRequestException(
        "Cada período do plano deve ter um número de meses diferente",
      );
    }
  }

  private toItemRows(serviceIds: string[]) {
    return serviceIds.map((serviceId) => ({ serviceId }));
  }

  private toResponse(plan: PlanWithDetails): PlanResponse {
    const { items, ...rest } = plan;

    return { ...rest, services: items.map((item) => item.service) };
  }

  private mapUniqueViolation(error: unknown): unknown {
    return isUniqueConstraintViolation(error)
      ? new ConflictException("Já existe um plano com este nome na empresa")
      : error;
  }
}
