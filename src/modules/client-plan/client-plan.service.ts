import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PlanBillingType } from "../../../generated/prisma/enums";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { formatTimeOfDay } from "../../common/time/time-of-day";
import { toZonedParts } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { LONG_TRANSACTION_TIMEOUT_MS } from "../../prisma/transaction-options";
import { CompanyService } from "../company/company.service";
import { PaymentService } from "../payment/payment.service";
import {
  PlanResponse,
  PlanService,
  PlanServiceResponse,
} from "../plan/plan.service";
import { RecurringDayDto } from "../recurring-appointment/dto/recurring-day.dto";
import { RecurringAppointmentService } from "../recurring-appointment/recurring-appointment.service";
import {
  calculateDueDates,
  calculateEndDate,
  calculatePlanPricing,
} from "./client-plan.calculations";
import { ClientPlanScheduleDto } from "./dto/client-plan-schedule.dto";
import { CreateClientPlanDto } from "./dto/create-client-plan.dto";
import {
  ClientPlanStatus,
  FindClientPlansQueryDto,
} from "./dto/find-client-plans-query.dto";

/**
 * A contratação é devolvida com os dados relacionados que as telas desenham sem
 * novas chamadas (só o necessário) e com a agenda de cada serviço. As relações
 * são lidas pela chave, sem filtrar exclusão lógica nem inatividade: pessoa,
 * plano ou serviço excluídos ou inativados depois continuam com o nome.
 */
const withDetails = {
  include: {
    client: { select: { id: true, name: true, photoUrl: true } },
    plan: { select: { id: true, name: true } },
    recurringAppointments: {
      select: {
        id: true,
        serviceId: true,
        professionalId: true,
        isActive: true,
        service: {
          select: { id: true, name: true, color: true, duration: true },
        },
        professional: { select: { id: true, name: true, photoUrl: true } },
        // Dias da semana na ordem natural (segunda a domingo), depois por horário.
        days: {
          select: { weekDay: true, startTime: true, endTime: true },
          orderBy: [{ weekDay: "asc" }, { startTime: "asc" }],
        },
      },
      orderBy: { createdAt: "asc" },
    },
  },
} satisfies Prisma.ClientPlanDefaultArgs;

type ClientPlanRow = Prisma.ClientPlanGetPayload<typeof withDetails>;

// Como a API devolve: os horários dos dias saem como "HH:MM", como nas recorrências.
export type ClientPlanResponse = Omit<
  ClientPlanRow,
  "recurringAppointments"
> & {
  recurringAppointments: (Omit<
    ClientPlanRow["recurringAppointments"][number],
    "days"
  > & { days: RecurringDayDto[] })[];
};

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
      // Um plano longo gera centenas de agendamentos (ver transaction-options).
      { timeout: LONG_TRANSACTION_TIMEOUT_MS },
    );

    return this.findOne(clientPlanId, companyId);
  }

  /**
   * Cancela a contratação, sem multa e sem reembolso. Encerra as agendas dos
   * serviços (agendamentos futuros viram CANCELLED) e, no mensal, cancela as
   * parcelas a vencer. No integral, o pagamento não muda: é feito no ato.
   */
  async cancel(id: string, companyId: string): Promise<ClientPlanResponse> {
    const clientPlan = await this.findOne(id, companyId);
    const timeZone = await this.companyService.getTimeZone(companyId);
    const today = this.todayIn(timeZone);

    if (clientPlan.cancelledAt) {
      throw new BadRequestException("A contratação já está cancelada");
    }
    if (clientPlan.endDate < today) {
      throw new BadRequestException(
        "A contratação já terminou e não pode ser cancelada",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.clientPlan.update({
        where: { id },
        data: { cancelledAt: new Date(), updatedAt: new Date() },
      });

      await this.recurringAppointmentService.endForClientPlan(
        tx,
        id,
        companyId,
      );

      if (clientPlan.billingType === PlanBillingType.MONTHLY) {
        await this.paymentService.cancelUpcomingForClientPlan(tx, id, today);
      }
    });

    return this.findOne(id, companyId);
  }

  async findAll(
    { page, limit, clientId, planId, status }: FindClientPlansQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<ClientPlanResponse>> {
    const where: Prisma.ClientPlanWhereInput = {
      companyId,
      clientId,
      planId,
      ...(await this.statusFilter(status, companyId)),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.clientPlan.findMany({
        where,
        ...withDetails,
        // Da contratação mais recente para a mais antiga. O id desempata
        // contratações criadas no mesmo instante e mantém a paginação estável.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.clientPlan.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toResponse(item)),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string, companyId: string): Promise<ClientPlanResponse> {
    const clientPlan = await this.prisma.clientPlan.findFirst({
      where: { id, companyId },
      ...withDetails,
    });

    if (!clientPlan) {
      throw new NotFoundException("Contratação de plano não encontrada");
    }

    return this.toResponse(clientPlan);
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

    // A frequência do plano é exata: cada horário da agenda é um atendimento
    // semanal (o mesmo dia pode ter dois horários que não se sobrepõem).
    for (const service of plan.services) {
      const days = schedules.find(
        (schedule) => schedule.serviceId === service.id,
      )?.days;
      if (days && days.length !== service.sessionsPerWeek) {
        throw new BadRequestException(this.frequencyMessage(service));
      }
    }
  }

  // Ex.: "Pilates: escolha 2 dias da semana (o plano prevê 2 atendimentos por semana)".
  private frequencyMessage({ name, sessionsPerWeek }: PlanServiceResponse) {
    const days = sessionsPerWeek === 1 ? "1 dia" : `${sessionsPerWeek} dias`;
    const sessions =
      sessionsPerWeek === 1
        ? "1 atendimento"
        : `${sessionsPerWeek} atendimentos`;

    return `${name}: escolha ${days} da semana (o plano prevê ${sessions} por semana)`;
  }

  /**
   * Sem data, a contratação começa hoje no calendário da empresa. Uma data
   * futura é aceita; uma passada, não, porque o período pago já estaria correndo.
   */
  private resolveStartDate(startDate: Date | undefined, timeZone: string) {
    const today = this.todayIn(timeZone);

    if (!startDate) {
      return today;
    }

    if (startDate < today) {
      throw new BadRequestException("startDate não pode ser uma data passada");
    }

    return startDate;
  }

  /**
   * Situação da contratação, com "hoje" no fuso da empresa: ativa é a não
   * cancelada que ainda não terminou (inclui as que vão começar); encerrada é a
   * não cancelada cuja data final já passou. Sem o filtro, nem consulta o fuso.
   */
  private async statusFilter(
    status: ClientPlanStatus | undefined,
    companyId: string,
  ): Promise<Prisma.ClientPlanWhereInput> {
    if (!status) {
      return {};
    }
    if (status === "cancelled") {
      return { cancelledAt: { not: null } };
    }

    const today = this.todayIn(
      await this.companyService.getTimeZone(companyId),
    );

    return status === "active"
      ? { cancelledAt: null, endDate: { gte: today } }
      : { cancelledAt: null, endDate: { lt: today } };
  }

  // Os horários dos dias saem como "HH:MM", como nas recorrências.
  private toResponse(row: ClientPlanRow): ClientPlanResponse {
    return {
      ...row,
      recurringAppointments: row.recurringAppointments.map(
        ({ days, ...recurring }) => ({
          ...recurring,
          days: days.map((day) => ({
            weekDay: day.weekDay,
            startTime: formatTimeOfDay(day.startTime),
            endTime: formatTimeOfDay(day.endTime),
          })),
        }),
      ),
    };
  }

  // Data de hoje (pura, sem hora) no calendário da empresa.
  private todayIn(timeZone: string): Date {
    const { year, month, day } = toZonedParts(new Date(), timeZone);

    return new Date(Date.UTC(year, month - 1, day));
  }
}
