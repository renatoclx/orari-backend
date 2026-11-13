import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { UserType } from "../../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import { AutoMessageService } from "../auto-message/auto-message.service";
import {
  formatDayMonth,
  formatTime,
  localDate,
  reminderStartRange,
} from "../auto-message/auto-message-schedule";
import { PROFESSIONAL_REMINDER_MINUTES } from "../auto-message/auto-message.catalog";
import { firstName, renderMessage } from "../auto-message/auto-message-text";
import {
  NotifierCompanies,
  type NotifierCompany,
} from "./notifier-companies.service";
import { NotificationDispatcher } from "./notification-dispatcher.service";
import {
  attendanceCount,
  reminderUnits,
  summaryWindowOpen,
  UPCOMING_STATUSES,
} from "./professional-notifier";
import { buildHome, homeRanges } from "../professional-app/professional-home";

interface ProfessionalUser {
  id: string;
  name: string;
  peopleId: string;
}

/**
 * Avisos ao profissional que dependem do relógio: o lembrete do próximo
 * atendimento (30 minutos antes) e o resumo da manhã (às 7h30). A clínica liga
 * e edita o texto em Mensagens → Automáticas; valem as empresas com Mensagens
 * no plano (o portal do cliente não precisa estar ligado). Rodar de novo não
 * repete nada: cada aviso tem uma chave única por usuário.
 */
@Injectable()
export class ProfessionalNotifierJob {
  private readonly logger = new Logger(ProfessionalNotifierJob.name);
  private runningReminders = false;
  private runningSummary = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly autoMessageService: AutoMessageService,
    private readonly dispatcher: NotificationDispatcher,
    private readonly directory: NotifierCompanies,
  ) {}

  // Os usuários só-app (PROFESSIONAL) da clínica, com o profissional de cada um.
  private async professionalUsers(
    companyId: string,
  ): Promise<ProfessionalUser[]> {
    const users = await this.prisma.user.findMany({
      where: {
        companyId,
        deletedAt: null,
        type: UserType.PROFESSIONAL,
        peopleId: { not: null },
      },
      select: { id: true, name: true, peopleId: true },
    });
    return users.flatMap((user) =>
      user.peopleId ? [{ ...user, peopleId: user.peopleId }] : [],
    );
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reminders(now = new Date()): Promise<number> {
    if (this.runningReminders) return 0;
    this.runningReminders = true;
    let sent = 0;
    try {
      for (const company of await this.directory.list()) {
        sent += await this.remindersOf(company, now);
      }
      if (sent > 0) this.logger.log(`Lembretes ao profissional: ${sent}`);
    } catch (error) {
      this.fail("lembretes", error);
    } finally {
      this.runningReminders = false;
    }
    return sent;
  }

  private async remindersOf(
    company: NotifierCompany,
    now: Date,
  ): Promise<number> {
    const settings = await this.autoMessageService.findOne(
      company.id,
      "PROFESSIONAL_REMINDER",
    );
    if (!settings.enabled) return 0;
    const users = await this.professionalUsers(company.id);
    if (users.length === 0) return 0;
    const byPerson = new Map(users.map((user) => [user.peopleId, user]));

    const { after, until } = reminderStartRange(
      now,
      PROFESSIONAL_REMINDER_MINUTES,
    );
    const appointments = await this.prisma.appointment.findMany({
      where: {
        companyId: company.id,
        professionalId: { in: [...byPerson.keys()] },
        status: { in: UPCOMING_STATUSES },
        startAt: { gt: after, lte: until },
      },
      orderBy: { startAt: "asc" },
      select: {
        id: true,
        startAt: true,
        professionalId: true,
        classSessionId: true,
        service: { select: { name: true } },
      },
    });

    let sent = 0;
    for (const unit of reminderUnits(
      appointments.map((row) => ({
        id: row.id,
        startAt: row.startAt,
        professionalId: row.professionalId,
        classSessionId: row.classSessionId,
        serviceName: row.service.name,
      })),
    )) {
      const user = byPerson.get(unit.professionalId);
      if (!user) continue;
      const name = firstName(user.name);
      sent += await this.dispatcher.notify({
        companyId: company.id,
        userIds: [user.id],
        category: "REMINDER",
        title: "Próximo atendimento",
        // O texto não leva o nome do cliente: serve à caixa e ao push.
        body: renderMessage(settings.body, {
          nome: name,
          profissional: name,
          estabelecimento: company.name,
          data: formatDayMonth(unit.startAt, company.timezone),
          hora: formatTime(unit.startAt, company.timezone),
          servico: unit.serviceName,
        }),
        url: `/app/agenda?dia=${localDate(unit.startAt, company.timezone)}`,
        // A mesma chave para o mesmo atendimento, sempre: não repete.
        dedupeKey: `reminder:${unit.key}`,
      });
    }
    return sent;
  }

  // A cada 5 minutos, e não uma vez na hora certa: se a API reiniciar às 7h40,
  // o resumo do dia ainda sai (a chave única evita repetir).
  @Cron(CronExpression.EVERY_5_MINUTES)
  async summaries(now = new Date()): Promise<number> {
    if (this.runningSummary) return 0;
    this.runningSummary = true;
    let sent = 0;
    try {
      for (const company of await this.directory.list()) {
        if (!summaryWindowOpen(now, company.timezone)) continue;
        sent += await this.summaryOf(company, now);
      }
      if (sent > 0) this.logger.log(`Resumos da manhã: ${sent}`);
    } catch (error) {
      this.fail("resumos da manhã", error);
    } finally {
      this.runningSummary = false;
    }
    return sent;
  }

  private async summaryOf(
    company: NotifierCompany,
    now: Date,
  ): Promise<number> {
    const settings = await this.autoMessageService.findOne(
      company.id,
      "PROFESSIONAL_SUMMARY",
    );
    if (!settings.enabled) return 0;
    const users = await this.professionalUsers(company.id);
    if (users.length === 0) return 0;

    const range = homeRanges(now, company.timezone);
    const rows = await this.prisma.appointment.findMany({
      where: {
        companyId: company.id,
        professionalId: { in: users.map((user) => user.peopleId) },
        startAt: { gte: range.todayStart, lt: range.tomorrowStart },
      },
      orderBy: { startAt: "asc" },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        classSessionId: true,
        clientId: true,
        professionalId: true,
        client: { select: { name: true } },
        service: { select: { name: true } },
      },
    });

    const today = localDate(now, company.timezone);
    let sent = 0;
    for (const user of users) {
      // A mesma conta do Início: turma conta uma vez e cancelado fica de fora.
      const { today: day } = buildHome(
        rows
          .filter((row) => row.professionalId === user.peopleId)
          .map((row) => ({
            id: row.id,
            startAt: row.startAt,
            endAt: row.endAt,
            status: row.status,
            classSessionId: row.classSessionId,
            clientId: row.clientId,
            clientName: row.client.name,
            serviceName: row.service.name,
          })),
        [],
        now,
        company.timezone,
      );
      // Dia livre não manda nada.
      if (day.total === 0 || !day.next) continue;
      const name = firstName(user.name);
      sent += await this.dispatcher.notify({
        companyId: company.id,
        userIds: [user.id],
        category: "DAILY_SUMMARY",
        title: "Resumo do dia",
        body: renderMessage(settings.body, {
          nome: name,
          estabelecimento: company.name,
          data: formatDayMonth(now, company.timezone),
          hora: formatTime(day.next.startAt, company.timezone),
          quantidade: attendanceCount(day.total),
        }),
        url: "/app/agenda",
        dedupeKey: `summary:${today}`,
      });
    }
    return sent;
  }

  private fail(what: string, error: unknown): void {
    this.logger.warn(
      `Avisos ao profissional (${what}) falharam: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
