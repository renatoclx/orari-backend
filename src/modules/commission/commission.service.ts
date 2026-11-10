import { Injectable } from "@nestjs/common";
import { AppointmentStatus } from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { PrismaService } from "../../prisma/prisma.service";
import {
  commissionAmount,
  commissionBase,
  packageSessionValue,
} from "./commission.calculations";

// Quantos atendimentos de um serviço por rodada: o resto fica para a próxima.
const BATCH = 500;

/**
 * Comissão do profissional (ver docs/business-rules.md, "Comissão"). Uma por
 * atendimento concluído de serviço com comissão, só dos que terminaram depois
 * de a comissão passar a valer no serviço (`commissionSince`).
 */
@Injectable()
export class CommissionService {
  constructor(private readonly prisma: PrismaService) {}

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
        price: true,
        commissionType: true,
        commissionValue: true,
        commissionSince: true,
      },
    });

    // Sessões geradas por contratação, contadas uma vez por rodada.
    const sessionValues = new Map<string, Decimal>();
    let created = 0;

    for (const service of services) {
      const rows = await this.prisma.appointment.findMany({
        where: {
          serviceId: service.id,
          // Cancelado nunca chega a concluído: não gera comissão.
          status: AppointmentStatus.COMPLETED,
          endAt: { gte: service.commissionSince! },
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
      if (rows.length === 0) continue;

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
      created += result.count;
    }
    return created;
  }
}
