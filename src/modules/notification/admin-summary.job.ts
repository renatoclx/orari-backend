import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { UserType } from "../../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import { ADMIN_SUMMARY_LAST_HOUR } from "../auto-message/auto-message.catalog";
import {
  formatDayMonth,
  localHour,
} from "../auto-message/auto-message-schedule";
import { AutoMessageService } from "../auto-message/auto-message.service";
import { firstName, renderMessage } from "../auto-message/auto-message-text";
import {
  NotifierCompanies,
  type NotifierCompany,
} from "./notifier-companies.service";
import { NotificationDispatcher } from "./notification-dispatcher.service";
import { summaryText } from "./pending-summary";
import { PendingSummaryService } from "./pending-summary.service";

// Hora padrão do resumo quando a clínica nunca salvou a situação.
const DEFAULT_HOUR = 8;

/**
 * O resumo de pendências do administrador: uma vez por dia, na hora escolhida
 * em Mensagens → Administrador (padrão 8h, até o meio-dia), só com os itens
 * escolhidos e que o plano libera. Dia sem nenhum item com número não manda
 * nada. A chave `pending:AAAA-MM-DD` por usuário impede repetir.
 */
@Injectable()
export class AdminSummaryJob {
  private readonly logger = new Logger(AdminSummaryJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: NotifierCompanies,
    private readonly autoMessageService: AutoMessageService,
    private readonly pending: PendingSummaryService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  // A cada 5 minutos, e não uma vez na hora certa: se a API reiniciar às 8h20,
  // o resumo do dia ainda sai.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async summaries(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      for (const company of await this.companies.list()) {
        sent += await this.summaryOf(company, now);
      }
      if (sent > 0) this.logger.log(`Resumos de pendências: ${sent}`);
    } catch (error) {
      this.logger.warn(
        `Resumos de pendências falharam: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.running = false;
    }
    return sent;
  }

  private async summaryOf(
    company: NotifierCompany,
    now: Date,
  ): Promise<number> {
    const settings = await this.autoMessageService.findOne(
      company.id,
      "ADMIN_SUMMARY",
    );
    if (!settings.enabled) return 0;
    const hour = localHour(now, company.timezone);
    if (hour < (settings.summaryHour ?? DEFAULT_HOUR)) return 0;
    if (hour >= ADMIN_SUMMARY_LAST_HOUR) return 0;

    const admins = await this.prisma.user.findMany({
      where: { companyId: company.id, deletedAt: null, type: UserType.ADMIN },
      select: { id: true, name: true },
    });
    if (admins.length === 0) return 0;

    const { date, items } = await this.pending.compute(
      company.id,
      now,
      company.timezone,
      settings.summaryItems,
    );
    const text = summaryText(items);
    // Nada com número hoje: não manda nada.
    if (!text) return 0;

    let sent = 0;
    for (const admin of admins) {
      sent += await this.dispatcher.notify({
        companyId: company.id,
        userIds: [admin.id],
        category: "PENDING_SUMMARY",
        title: "Pendências de hoje",
        body: renderMessage(settings.body, {
          nome: firstName(admin.name),
          estabelecimento: company.name,
          data: formatDayMonth(now, company.timezone),
          resumo: text,
        }),
        url: "/dashboard",
        dedupeKey: `pending:${date}`,
        // Números de dinheiro não vão para a tela bloqueada.
        push: {
          title: "Pendências de hoje",
          body: "Há itens para ver hoje no painel.",
        },
      });
    }
    return sent;
  }
}
