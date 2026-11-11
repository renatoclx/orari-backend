import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AppointmentStatus,
  CommissionType,
  PaymentStatus,
  PeopleType,
} from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import type { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { periodOf } from "../../common/time/report-period";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import {
  CommissionAdvanceService,
  availableOf,
} from "./commission-advance.service";
import {
  clientPaidFor,
  commissionAmount,
  commissionBase,
  packageSessionValue,
} from "./commission.calculations";
import type {
  CommissionListQueryDto,
  CommissionSummaryQueryDto,
} from "./dto/commission-query.dto";

/** Totais de um grupo de comissões (valores em texto, duas casas). */
export interface CommissionTotals {
  count: number;
  base: string;
  amount: string;
  /** Quanto da base os clientes já pagaram. */
  clientPaid: string;
}

/** Em aberto (ainda não fechado), sem depender do período. */
export interface OpenTotals {
  advanced: string;
  /** Comissão em aberto menos o adiantado. */
  toPay: string;
}

export interface CommissionSummary extends CommissionTotals, OpenTotals {
  /** Do maior valor de comissão para o menor; empate pelo nome. */
  byProfessional: (CommissionTotals &
    OpenTotals & { id: string; name: string })[];
}

export interface CommissionItem {
  id: string;
  appointment: {
    id: string;
    startAt: Date;
    client: { id: string; name: string };
    service: { id: string; name: string };
    /** Sessão de pacote (a base é a parte da contratação). */
    fromPackage: boolean;
  };
  professional: { id: string; name: string };
  baseAmount: string;
  type: CommissionType;
  rate: string;
  amount: string;
  clientPaid: string;
  /** Fechamento que a quitou; null = em aberto. */
  closing: { id: string; number: number } | null;
}

const person = { select: { id: true, name: true } } as const;

// O que a tela lê de cada comissão, com o necessário para o "pago pelo cliente".
const commissionSelect = {
  id: true,
  baseAmount: true,
  type: true,
  rate: true,
  amount: true,
  closing: { select: { id: true, number: true } },
  professional: person,
  appointment: {
    select: {
      id: true,
      startAt: true,
      client: person,
      service: person,
      payment: { select: { status: true, deletedAt: true } },
      recurringAppointment: {
        select: {
          clientPlan: {
            select: {
              totalAmount: true,
              payments: {
                where: { status: PaymentStatus.PAID, deletedAt: null },
                select: { amount: true },
              },
            },
          },
        },
      },
    },
  },
} as const;

// Quantos atendimentos de um serviço por rodada: o resto fica para a próxima.
const BATCH = 500;

/**
 * Comissão do profissional (ver docs/business-rules/financeiro.md, "Comissão"). Uma por
 * atendimento concluído de serviço com comissão, só dos que terminaram depois
 * de a comissão passar a valer no serviço (`commissionSince`).
 */
@Injectable()
export class CommissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
    private readonly advanceService: CommissionAdvanceService,
  ) {}

  /** Totais do período e por profissional (ver "Comissão" nas regras). */
  async summary(
    query: CommissionSummaryQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<CommissionSummary> {
    const where = await this.listWhere(query, companyId, now);
    const [rows, balances] = await Promise.all([
      this.prisma.commission.findMany({ where, select: commissionSelect }),
      this.advanceService.openBalances(companyId, query.professionalId),
    ]);

    const total = newTotals();
    const byProfessional = new Map<
      string,
      Totals & { id: string; name: string }
    >();
    for (const row of rows) {
      const paid = paidOf(row);
      addTo(total, row.baseAmount, row.amount, paid);
      const current = byProfessional.get(row.professional.id) ?? {
        ...row.professional,
        ...newTotals(),
      };
      addTo(current, row.baseAmount, row.amount, paid);
      byProfessional.set(row.professional.id, current);
    }

    // Quem só tem saldo em aberto (sem atendimento no período) entra também.
    const missing = [...balances.keys()].filter(
      (id) => !byProfessional.has(id),
    );
    if (missing.length > 0) {
      const people = await this.prisma.people.findMany({
        where: { id: { in: missing }, companyId },
        select: { id: true, name: true },
      });
      for (const person of people) {
        byProfessional.set(person.id, { ...person, ...newTotals() });
      }
    }

    const zero = { commission: new Decimal(0), advanced: new Decimal(0) };
    const openOf = (id?: string) => {
      const list = id ? [balances.get(id) ?? zero] : [...balances.values()];
      const advanced = list.reduce(
        (sum, b) => sum.plus(b.advanced),
        new Decimal(0),
      );
      const toPay = list.reduce(
        (sum, b) => sum.plus(availableOf(b)),
        new Decimal(0),
      );
      return { advanced: advanced.toFixed(2), toPay: toPay.toFixed(2) };
    };

    return {
      ...totalsOut(total),
      ...openOf(),
      byProfessional: [...byProfessional.values()]
        .sort(
          (a, b) =>
            b.amount.comparedTo(a.amount) || a.name.localeCompare(b.name),
        )
        .map(({ id, name, ...totals }) => ({
          id,
          name,
          ...totalsOut(totals),
          ...openOf(id),
        })),
    };
  }

  /** Atendimento a atendimento, do mais recente para o mais antigo. */
  async list(
    { page, limit, ...query }: CommissionListQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<PaginatedResult<CommissionItem>> {
    const where = await this.listWhere(query, companyId, now);
    const [rows, total] = await Promise.all([
      this.prisma.commission.findMany({
        where,
        select: commissionSelect,
        orderBy: [{ appointment: { startAt: "desc" } }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.commission.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        appointment: {
          id: row.appointment.id,
          startAt: row.appointment.startAt,
          client: row.appointment.client,
          service: row.appointment.service,
          fromPackage: row.appointment.recurringAppointment?.clientPlan != null,
        },
        professional: row.professional,
        baseAmount: row.baseAmount.toFixed(2),
        type: row.type,
        rate: row.rate.toFixed(2),
        amount: row.amount.toFixed(2),
        clientPaid: paidOf(row).toFixed(2),
        closing: row.closing,
      })),
      total,
      page,
      limit,
    };
  }

  // Filtro comum: empresa, atendimento no período e o profissional (404 se não
  // for profissional da empresa).
  private async listWhere(
    { from, to, professionalId }: CommissionSummaryQueryDto,
    companyId: string,
    now: Date,
  ) {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const period = periodOf(from, to, timeZone, now);
    if (professionalId) {
      const professional = await this.prisma.people.findFirst({
        where: { id: professionalId, companyId, type: PeopleType.PROFESSIONAL },
        select: { id: true },
      });
      if (!professional) {
        throw new NotFoundException("Profissional não encontrado");
      }
    }
    return {
      companyId,
      professionalId,
      appointment: { startAt: { gte: period.start, lt: period.end } },
    };
  }

  /** Gera as comissões que faltam; devolve quantas foram gravadas. */
  async generatePending(): Promise<number> {
    const services = await this.prisma.service.findMany({
      where: {
        commissionType: { not: null },
        commissionValue: { not: null },
        commissionSince: { not: null },
      },
      select: {
        id: true,
        companyId: true,
        price: true,
        commissionType: true,
        commissionValue: true,
        commissionSince: true,
      },
    });

    // Profissionais que recebem comissão, por empresa (o dono vinculado a um
    // ADMIN nasce sem). Lidos uma vez por rodada.
    const receiversByCompany = new Map<
      string,
      { id: string; commissionSince: Date | null }[]
    >();
    const receiversOf = async (companyId: string) => {
      const cached = receiversByCompany.get(companyId);
      if (cached) return cached;
      const people = await this.prisma.people.findMany({
        where: {
          companyId,
          type: PeopleType.PROFESSIONAL,
          receivesCommission: true,
        },
        select: { id: true, commissionSince: true },
      });
      receiversByCompany.set(companyId, people);
      return people;
    };

    // Sessões geradas por contratação, contadas uma vez por rodada.
    const sessionValues = new Map<string, Decimal>();
    let created = 0;

    for (const service of services) {
      for (const professional of await receiversOf(service.companyId)) {
        created += await this.generateFor(service, professional, sessionValues);
      }
    }
    return created;
  }

  // Comissões de um serviço e um profissional: a partir da data mais recente
  // entre as duas (sem retroativo pelo tempo em que um deles estava sem).
  private async generateFor(
    service: {
      id: string;
      price: Decimal | null;
      commissionType: CommissionType | null;
      commissionValue: Decimal | null;
      commissionSince: Date | null;
    },
    professional: { id: string; commissionSince: Date | null },
    sessionValues: Map<string, Decimal>,
  ): Promise<number> {
    const since =
      professional.commissionSince &&
      professional.commissionSince > service.commissionSince!
        ? professional.commissionSince
        : service.commissionSince!;
    const rows = await this.prisma.appointment.findMany({
      where: {
        serviceId: service.id,
        professionalId: professional.id,
        // Cancelado nunca chega a concluído: não gera comissão.
        status: AppointmentStatus.COMPLETED,
        endAt: { gte: since },
        commission: { is: null },
      },
      orderBy: { endAt: "asc" },
      take: BATCH,
      select: {
        id: true,
        companyId: true,
        professionalId: true,
        payment: { select: { amount: true, status: true, deletedAt: true } },
        recurringAppointment: {
          select: {
            clientPlanId: true,
            clientPlan: { select: { totalAmount: true } },
          },
        },
      },
    });
    if (rows.length === 0) return 0;

    for (const row of rows) {
      const plan = row.recurringAppointment;
      if (plan?.clientPlanId && !sessionValues.has(plan.clientPlanId)) {
        const sessions = await this.prisma.appointment.count({
          where: {
            recurringAppointment: { clientPlanId: plan.clientPlanId },
          },
        });
        sessionValues.set(
          plan.clientPlanId,
          packageSessionValue(plan.clientPlan!.totalAmount, sessions),
        );
      }
    }

    const rate = service.commissionValue!;
    const data = rows.map((row) => {
      const clientPlanId = row.recurringAppointment?.clientPlanId ?? null;
      const base = commissionBase(
        { payment: row.payment, clientPlanId },
        service.price,
        clientPlanId ? (sessionValues.get(clientPlanId) ?? null) : null,
      );
      return {
        companyId: row.companyId,
        appointmentId: row.id,
        professionalId: row.professionalId,
        serviceId: service.id,
        baseAmount: base,
        type: service.commissionType!,
        rate,
        amount: commissionAmount(service.commissionType!, rate, base),
      };
    });

    // A unicidade por atendimento protege duas rodadas ao mesmo tempo.
    const result = await this.prisma.commission.createMany({
      data,
      skipDuplicates: true,
    });
    return result.count;
  }
}

type Totals = {
  count: number;
  base: Decimal;
  amount: Decimal;
  clientPaid: Decimal;
};

const newTotals = (): Totals => ({
  count: 0,
  base: new Decimal(0),
  amount: new Decimal(0),
  clientPaid: new Decimal(0),
});

function addTo(totals: Totals, base: Decimal, amount: Decimal, paid: Decimal) {
  totals.count += 1;
  totals.base = totals.base.plus(base);
  totals.amount = totals.amount.plus(amount);
  totals.clientPaid = totals.clientPaid.plus(paid);
}

const totalsOut = (totals: Totals): CommissionTotals => ({
  count: totals.count,
  base: totals.base.toFixed(2),
  amount: totals.amount.toFixed(2),
  clientPaid: totals.clientPaid.toFixed(2),
});

// "Pago pelo cliente" de uma comissão lida com o commissionSelect.
function paidOf(row: {
  baseAmount: Decimal;
  appointment: {
    payment: { status: PaymentStatus; deletedAt: Date | null } | null;
    recurringAppointment: {
      clientPlan: {
        totalAmount: Decimal;
        payments: { amount: Decimal }[];
      } | null;
    } | null;
  };
}): Decimal {
  const plan = row.appointment.recurringAppointment?.clientPlan;
  return clientPaidFor({
    base: row.baseAmount,
    payment: row.appointment.payment,
    plan: plan
      ? {
          total: plan.totalAmount,
          paid: plan.payments.reduce(
            (sum, payment) => sum.plus(payment.amount),
            new Decimal(0),
          ),
        }
      : null,
  });
}
