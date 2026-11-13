import { Injectable } from "@nestjs/common";
import {
  AppointmentStatus,
  PayableStatus,
  PaymentStatus,
  PeopleType,
} from "../../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import {
  SUMMARY_ITEMS,
  type SummaryItem,
} from "../auto-message/auto-message.catalog";
import { isBirthday, localDate } from "../auto-message/auto-message-schedule";
import { CompanyAccessService } from "../company-access/company-access.service";
import { homeRanges } from "../professional-app/professional-home";
import { SUMMARY_ITEM_FEATURE, type SummaryCount } from "./pending-summary";

// Atendimentos que dão comanda no dia (a regra da tela Comandas).
const TAB_STATUSES = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.COMPLETED,
];

/**
 * As pendências do dia da clínica (contas a pagar, recebimentos atrasados,
 * comandas e aniversariantes), com o que o plano libera. Serve ao resumo das
 * manhãs e ao bloco do Dashboard.
 */
@Injectable()
export class PendingSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CompanyAccessService,
  ) {}

  /**
   * Os números de hoje, no calendário da clínica. `only` restringe aos itens
   * escolhidos (o resumo enviado); sem ele, todos os que o plano libera (o bloco
   * do Dashboard). Item sem a funcionalidade no plano nunca entra.
   */
  async compute(
    companyId: string,
    now: Date,
    timeZone: string,
    only?: readonly string[],
  ): Promise<{ date: string; items: SummaryCount[] }> {
    const date = localDate(now, timeZone);
    const items = await this.allowedItems(companyId, only);
    const counts = await Promise.all(
      items.map(async (item) => ({
        item,
        count: await this.count(item, companyId, now, timeZone, date),
      })),
    );
    return { date, items: counts };
  }

  // Os itens pedidos (ou todos) cuja funcionalidade o plano libera, na ordem do catálogo.
  private async allowedItems(
    companyId: string,
    only?: readonly string[],
  ): Promise<SummaryItem[]> {
    const wanted = SUMMARY_ITEMS.filter((item) => !only || only.includes(item));
    const features = [...new Set(wanted.map((i) => SUMMARY_ITEM_FEATURE[i]))];
    const allowed = new Set<string>();
    for (const feature of features) {
      if (await this.access.can(companyId, feature, "view")) {
        allowed.add(feature);
      }
    }
    return wanted.filter((item) => allowed.has(SUMMARY_ITEM_FEATURE[item]));
  }

  private async count(
    item: SummaryItem,
    companyId: string,
    now: Date,
    timeZone: string,
    date: string,
  ): Promise<number> {
    // Vencimento é data de calendário (coluna `date`, UTC 00:00).
    const today = new Date(`${date}T00:00:00.000Z`);
    switch (item) {
      case "PAYABLE_TODAY":
        return this.prisma.payable.count({
          where: { companyId, status: PayableStatus.PENDING, dueDate: today },
        });
      case "PAYABLE_OVERDUE":
        return this.prisma.payable.count({
          where: {
            companyId,
            status: PayableStatus.PENDING,
            dueDate: { lt: today },
          },
        });
      case "RECEIVABLE_OVERDUE":
        // A mesma regra da Análise de recebíveis: pendente com vencimento antes de hoje.
        return this.prisma.payment.count({
          where: {
            companyId,
            deletedAt: null,
            status: PaymentStatus.PENDING,
            dueDate: { lt: today },
          },
        });
      case "OPEN_TABS": {
        const range = homeRanges(now, timeZone);
        const clients = await this.prisma.appointment.findMany({
          where: {
            companyId,
            status: { in: TAB_STATUSES },
            startAt: { gte: range.todayStart, lt: range.tomorrowStart },
          },
          distinct: ["clientId"],
          select: { clientId: true },
        });
        return clients.length;
      }
      case "BIRTHDAYS": {
        const people = await this.prisma.people.findMany({
          where: {
            companyId,
            type: PeopleType.CLIENT,
            deletedAt: null,
            birthDate: { not: null },
          },
          select: { birthDate: true },
        });
        return people.filter(
          ({ birthDate }) => birthDate && isBirthday(birthDate, date),
        ).length;
      }
    }
  }
}
