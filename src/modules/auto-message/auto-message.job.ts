import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AppointmentStatus, PeopleType } from "../../../generated/prisma/enums";
import { zonedToUtc } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { AutoMessageService } from "./auto-message.service";
import {
  AutoMessageSender,
  type SendingCompany,
} from "./auto-message-sender.service";
import {
  BIRTHDAY_HOUR,
  MISS_YOU_HOUR,
  isBirthday,
  localDate,
  localHour,
  reminderStartRange,
  shiftDate,
} from "./auto-message-schedule";

const UPCOMING = [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED];

// Cliente da clínica que recebe: ativo e com conta no app.
const RECEIVES = {
  type: PeopleType.CLIENT,
  deletedAt: null,
  clientAccountId: { not: null },
} as const;

/**
 * Mensagens automáticas que dependem do relógio: o lembrete antes do horário
 * (a cada 5 minutos) e, uma vez por dia no relógio da clínica, o aniversário
 * (9h) e o "sentimos sua falta" (10h). Rodar de novo não repete nada: cada
 * envio tem uma chave única (ver AutoMessageSender).
 */
@Injectable()
export class AutoMessageJob {
  private readonly logger = new Logger(AutoMessageJob.name);
  private runningReminders = false;
  private runningDaily = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly autoMessageService: AutoMessageService,
    private readonly sender: AutoMessageSender,
  ) {}

  /** Clínicas com Mensagens no plano que, agora, podem enviar. */
  private async sendingCompanies(): Promise<SendingCompany[]> {
    const rows = await this.prisma.companyFeatureAccess.findMany({
      where: { feature: "messages", canView: true },
      select: { companyId: true },
    });
    const companies = await Promise.all(
      rows.map(({ companyId }) => this.sender.sendingCompany(companyId)),
    );
    return companies.filter((company) => company !== null);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reminders(now = new Date()): Promise<number> {
    if (this.runningReminders) return 0;
    this.runningReminders = true;
    let sent = 0;
    try {
      for (const company of await this.sendingCompanies()) {
        const settings = await this.autoMessageService.findOne(
          company.id,
          "REMINDER",
        );
        if (!settings.enabled) continue;
        for (const offset of settings.reminderOffsets) {
          const { after, until } = reminderStartRange(now, offset);
          const appointments = await this.prisma.appointment.findMany({
            where: {
              companyId: company.id,
              status: { in: UPCOMING },
              startAt: { gt: after, lte: until },
              client: RECEIVES,
            },
            select: { id: true },
          });
          for (const { id } of appointments) {
            if (
              await this.sender.sendForAppointment("REMINDER", id, {
                company,
                reminderOffset: offset,
              })
            ) {
              sent += 1;
            }
          }
        }
      }
      if (sent > 0) this.logger.log(`Lembretes enviados: ${sent}`);
    } catch (error) {
      this.fail("lembretes", error);
    } finally {
      this.runningReminders = false;
    }
    return sent;
  }

  // A cada 10 minutos, e não uma vez na hora certa: se a API reiniciar às
  // 9h05, o aniversário do dia ainda sai (a chave única evita repetir).
  @Cron(CronExpression.EVERY_10_MINUTES)
  async daily(now = new Date()): Promise<number> {
    if (this.runningDaily) return 0;
    this.runningDaily = true;
    let sent = 0;
    try {
      for (const company of await this.sendingCompanies()) {
        const hour = localHour(now, company.timezone);
        if (hour === BIRTHDAY_HOUR) sent += await this.birthdays(company, now);
        if (hour === MISS_YOU_HOUR) sent += await this.missYou(company, now);
      }
      if (sent > 0) this.logger.log(`Aniversários e faltas enviados: ${sent}`);
    } catch (error) {
      this.fail("aniversários e faltas", error);
    } finally {
      this.runningDaily = false;
    }
    return sent;
  }

  private async birthdays(company: SendingCompany, now: Date) {
    const settings = await this.autoMessageService.findOne(
      company.id,
      "BIRTHDAY",
    );
    if (!settings.enabled) return 0;
    const today = localDate(now, company.timezone);
    const people = await this.prisma.people.findMany({
      where: { companyId: company.id, ...RECEIVES, birthDate: { not: null } },
      select: { id: true, name: true, birthDate: true, clientAccountId: true },
    });
    let sent = 0;
    for (const person of people) {
      if (!person.birthDate || !person.clientAccountId) continue;
      if (!isBirthday(person.birthDate, today)) continue;
      const done = await this.sender.sendToPerson(
        "BIRTHDAY",
        company,
        { name: person.name, clientAccountId: person.clientAccountId },
        settings.body,
        `birthday:${person.id}:${today.slice(0, 4)}`,
      );
      if (done) sent += 1;
    }
    return sent;
  }

  /**
   * Quem teve o último atendimento concluído exatamente X dias atrás e não tem
   * nada marcado. O dia exato (e não "X ou mais"): ligar a opção não manda a
   * mensagem para todos os clientes antigos de uma vez.
   */
  private async missYou(company: SendingCompany, now: Date) {
    const settings = await this.autoMessageService.findOne(
      company.id,
      "MISS_YOU",
    );
    if (!settings.enabled || !settings.missYouDays) return 0;
    const target = shiftDate(
      localDate(now, company.timezone),
      -settings.missYouDays,
    );
    const dayStart = this.startOfDay(target, company.timezone);
    const dayEnd = this.startOfDay(shiftDate(target, 1), company.timezone);

    const visits = await this.prisma.appointment.findMany({
      where: {
        companyId: company.id,
        status: AppointmentStatus.COMPLETED,
        endAt: { gte: dayStart, lt: dayEnd },
        client: RECEIVES,
      },
      select: {
        client: { select: { id: true, name: true, clientAccountId: true } },
      },
      distinct: ["clientId"],
    });
    let sent = 0;
    for (const { client } of visits) {
      if (!client.clientAccountId) continue;
      // Voltou depois, ou já tem horário marcado: não sentimos a falta.
      const since = await this.prisma.appointment.count({
        where: {
          companyId: company.id,
          clientId: client.id,
          OR: [
            { status: AppointmentStatus.COMPLETED, endAt: { gte: dayEnd } },
            {
              status: { in: [...UPCOMING, AppointmentStatus.IN_PROGRESS] },
              endAt: { gt: now },
            },
          ],
        },
      });
      if (since > 0) continue;
      const done = await this.sender.sendToPerson(
        "MISS_YOU",
        company,
        { name: client.name, clientAccountId: client.clientAccountId },
        settings.body,
        `miss-you:${client.id}:${target}`,
      );
      if (done) sent += 1;
    }
    return sent;
  }

  // Meia-noite de uma data no relógio da clínica, em UTC.
  private startOfDay(date: string, timeZone: string): Date {
    const [year, month, day] = date.split("-").map(Number);
    return zonedToUtc({ year, month, day, hours: 0, minutes: 0 }, timeZone);
  }

  private fail(what: string, error: unknown) {
    this.logger.error(
      `Falha nas mensagens automáticas (${what})`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}
