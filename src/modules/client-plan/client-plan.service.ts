import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { toZonedParts } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { PaymentService } from "../payment/payment.service";
import { PlanResponse, PlanService } from "../plan/plan.service";
import { RecurringAppointmentService } from "../recurring-appointment/recurring-appointment.service";
import {
  calculateDueDates,
  calculateEndDate,
  calculatePlanPricing,
} from "./client-plan.calculations";
import { ClientPlanScheduleDto } from "./dto/client-plan-schedule.dto";
import { CreateClientPlanDto } from "./dto/create-client-plan.dto";
import { FindClientPlansQueryDto } from "./dto/find-client-plans-query.dto";

/**
 * Tempo máximo da transação da contratação. Um plano longo gera centenas de
 * agendamentos, cada um validado contra a agenda; o padrão do Prisma (5 s) não
 * basta. Ver docs/technical-debt.md.
 */
const CONTRACT_TRANSACTION_TIMEOUT_MS = 30_000;

// A contratação é devolvida com um resumo das agendas geradas por serviço.
const withSchedules = {
  include: {
    recurringAppointments: {
      select: { id: true, serviceId: true, professionalId: true },
      orderBy: { createdAt: "asc" },
    },
  },
} satisfies Prisma.ClientPlanDefaultArgs;

export type ClientPlanResponse = Prisma.ClientPlanGetPayload<
  typeof withSchedules
>;

/**
 * Contratações pertencem à empresa do usuário autenticado; as de outras empresas
 * se comportam como inexistentes (404).
 *
 * Este service coordena a contratação, mas não grava as tabelas de outros
 * módulos: as agendas são criadas pelo RecurringAppointmentService e os
 * pagamentos pelo PaymentService, todos na mesma transação. As contas de
 * valores e datas ficam em client-plan.calculations.ts.
 */
@Injectable()
export class ClientPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planService: PlanService,
    private readonly companyService: CompanyService,
    private readonly recurringAppointmentService: RecurringAppointmentService,
    private readonly paymentService: PaymentService,
  ) {}

  async create(
    dto: CreateClientPlanDto,
    companyId: string,
  ): Promise<ClientPlanResponse> {
    // Validações que só leem: rodam antes de abrir a transação.
    const plan = await this.planService.findOne(dto.planId, companyId);
    const period = this.ensurePlanCanBeContracted(plan, dto.months);
    this.ensureSchedulesCoverPlan(dto.schedules, plan);

    const timeZone = await this.companyService.getTimeZone(companyId);
    const startDate = this.resolveStartDate(dto.startDate, timeZone);
    const endDate = calculateEndDate(startDate, dto.months);

    const pricing = calculatePlanPricing({
      billingType: dto.billingType,
      months: dto.months,
      monthlyPrice: plan.monthlyPrice,
      discountPercent: period.discountPercent,
      monthlyDiscountPercent: period.monthlyDiscountPercent,
    });
    const dueDates = dto.firstDueDate
      ? calculateDueDates(dto.firstDueDate, pricing.paymentAmounts.length)
      : [];

    // Contratação, agendas e pagamentos nascem juntos: se algum horário
    // conflitar (ou o cliente/profissional for inválido), nada é gravado.
    const clientPlanId = await this.prisma.$transaction(
      async (tx) => {
        const clientPlan = await tx.clientPlan.create({
          data: {
            companyId,
            clientId: dto.clientId,
            planId: dto.planId,
            billingType: dto.billingType,
            months: dto.months,
            startDate,
            endDate,
            // Valores congelados: mudar o plano depois não altera a contratação.
            monthlyAmount: plan.monthlyPrice,
            discountPercent: pricing.discountPercent,
            totalAmount: pricing.totalAmount,
            firstDueDate: dto.firstDueDate ?? null,
          },
        });

        // Uma recorrência por serviço; ela também valida cliente e profissional.
        for (const schedule of dto.schedules) {
          await this.recurringAppointmentService.createForClientPlan(
            tx,
            {
              ...schedule,
              clientPlanId: clientPlan.id,
              clientId: dto.clientId,
              startDate,
              endDate,
            },
            companyId,
            timeZone,
          );
        }

        await this.paymentService.createForClientPlan(
          tx,
          companyId,
          clientPlan.id,
          pricing.paymentAmounts.map((amount, index) => ({
            amount,
            dueDate: dueDates[index] ?? null,
          })),
        );

        return clientPlan.id;
      },
      { timeout: CONTRACT_TRANSACTION_TIMEOUT_MS },
    );

    return this.findOne(clientPlanId, companyId);
  }

  async findAll(
    { page, limit, clientId, planId }: FindClientPlansQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<ClientPlanResponse>> {
    const where: Prisma.ClientPlanWhereInput = { companyId, clientId, planId };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.clientPlan.findMany({
        where,
        ...withSchedules,
        orderBy: { startDate: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.clientPlan.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, companyId: string): Promise<ClientPlanResponse> {
    const clientPlan = await this.prisma.clientPlan.findFirst({
      where: { id, companyId },
      ...withSchedules,
    });

    if (!clientPlan) {
      throw new NotFoundException("Contratação de plano não encontrada");
    }

    return clientPlan;
  }

  /**
   * O plano precisa estar ativo, com todos os serviços ativos e com um período
   * do número de meses escolhido. Devolve esse período (com os descontos).
   */
  private ensurePlanCanBeContracted(plan: PlanResponse, months: number) {
    if (!plan.isActive) {
      throw new ConflictException("Plano inativo");
    }

    const inactive = plan.services.filter((service) => !service.isActive);
    if (inactive.length > 0) {
      throw new ConflictException(
        `O plano tem serviços inativos: ${inactive.map((service) => service.name).join(", ")}`,
      );
    }

    const period = plan.periods.find((item) => item.months === months);
    if (!period) {
      throw new BadRequestException(
        `O plano não tem período de ${months} ${months === 1 ? "mês" : "meses"}`,
      );
    }

    return period;
  }

  // Cada serviço do plano precisa de exatamente uma agenda, e nada além deles.
  private ensureSchedulesCoverPlan(
    schedules: ClientPlanScheduleDto[],
    plan: PlanResponse,
  ) {
    const scheduled = schedules.map((schedule) => schedule.serviceId);
    if (new Set(scheduled).size !== scheduled.length) {
      throw new BadRequestException(
        "Cada serviço do plano deve ter uma única agenda",
      );
    }

    const planServiceIds = plan.services.map((service) => service.id);
    const missing = plan.services.filter(
      (service) => !scheduled.includes(service.id),
    );
    const extra = scheduled.filter((id) => !planServiceIds.includes(id));

    if (missing.length > 0 || extra.length > 0) {
      throw new BadRequestException(
        "Informe uma agenda para cada serviço do plano, e somente para eles" +
          (missing.length > 0
            ? `. Faltam: ${missing.map((service) => service.name).join(", ")}`
            : ""),
      );
    }
  }

  /**
   * Sem data, a contratação começa hoje no calendário da empresa. Uma data
   * futura é aceita; uma passada, não, porque o período pago já estaria correndo.
   */
  private resolveStartDate(startDate: Date | undefined, timeZone: string) {
    const { year, month, day } = toZonedParts(new Date(), timeZone);
    const today = new Date(Date.UTC(year, month - 1, day));

    if (!startDate) {
      return today;
    }

    if (startDate < today) {
      throw new BadRequestException("startDate não pode ser uma data passada");
    }

    return startDate;
  }
}
