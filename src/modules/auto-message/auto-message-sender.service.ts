import { Injectable } from "@nestjs/common";
import {
  AppointmentStatus,
  type AutoMessageKind,
  type ClientMessageKind,
} from "../../../generated/prisma/enums";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyAccessService } from "../company-access/company-access.service";
import { ClientNotifierService } from "../portal/client-notifier.service";
import { AutoMessageService } from "./auto-message.service";
import { formatDayMonth, formatTime } from "./auto-message-schedule";
import { firstName, renderMessage } from "./auto-message-text";

/** A clínica que pode enviar, com o que o texto e o relógio precisam. */
export interface SendingCompany {
  id: string;
  name: string;
  timezone: string;
}

// As situações que vão ao cliente (as do profissional têm outro caminho).
export type ClientAutoMessageKind = Exclude<
  AutoMessageKind,
  "PROFESSIONAL_REMINDER" | "PROFESSIONAL_SUMMARY" | "ADMIN_SUMMARY"
>;

export type AppointmentKind = Extract<
  AutoMessageKind,
  | "REMINDER"
  | "APPOINTMENT_CREATED"
  | "APPOINTMENT_RESCHEDULED"
  | "APPOINTMENT_CANCELLED"
>;

// Tipo do aviso na caixa do cliente (define o interruptor que vale). As
// situações do profissional não passam por aqui (vão pela caixa dele).
const NOTICE_KIND: Record<ClientAutoMessageKind, ClientMessageKind> = {
  REMINDER: "REMINDER",
  APPOINTMENT_CREATED: "APPOINTMENT",
  APPOINTMENT_RESCHEDULED: "APPOINTMENT",
  APPOINTMENT_CANCELLED: "APPOINTMENT",
  BIRTHDAY: "BIRTHDAY",
  MISS_YOU: "MISS_YOU",
};

// Tocar no aviso de um agendamento abre a aba Agendamentos do app.
const APPOINTMENTS_PATH = "/app/agendamentos";

// Situação do agendamento que cada aviso pede (os outros não são avisados).
const UPCOMING: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
];

/**
 * Envio de uma mensagem automática (ver docs/business-rules/mensagens.md, "Mensagens
 * automáticas"): confere a clínica e a situação, monta o texto, grava o
 * registro que impede repetir e entrega pelo ponto único de avisos do app.
 */
@Injectable()
export class AutoMessageSender {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autoMessageService: AutoMessageService,
    private readonly companyAccessService: CompanyAccessService,
    private readonly notifier: ClientNotifierService,
  ) {}

  /**
   * A clínica envia se está ativa, com o portal ligado e com o Portal do
   * cliente e as Mensagens no plano. Senão, nula.
   */
  async sendingCompany(companyId: string): Promise<SendingCompany | null> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        fantasyName: true,
        corporateReason: true,
        timezone: true,
        isActive: true,
        portalSettings: { select: { enabled: true } },
      },
    });
    if (!company?.isActive || !company.portalSettings?.enabled) return null;
    const [portal, messages] = await Promise.all([
      this.companyAccessService.can(companyId, "client-portal", "view"),
      this.companyAccessService.can(companyId, "messages", "view"),
    ]);
    if (!portal || !messages) return null;
    return {
      id: company.id,
      name: company.fantasyName ?? company.corporateReason,
      timezone: company.timezone,
    };
  }

  /**
   * Aviso de um agendamento: lembrete, marcado, alterado ou cancelado. Só
   * para horário que ainda não começou e cliente com conta no app. O job passa
   * a clínica já conferida e, no lembrete, de quantos minutos ele é.
   */
  async sendForAppointment(
    kind: AppointmentKind,
    appointmentId: string,
    {
      company,
      reminderOffset,
    }: { company?: SendingCompany | null; reminderOffset?: number } = {},
  ): Promise<boolean> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        companyId: true,
        status: true,
        startAt: true,
        service: { select: { name: true } },
        professional: { select: { name: true } },
        client: {
          select: {
            id: true,
            name: true,
            clientAccountId: true,
            deletedAt: true,
          },
        },
      },
    });
    if (!appointment || appointment.startAt <= new Date()) return false;
    const expected =
      kind === "APPOINTMENT_CANCELLED"
        ? appointment.status === AppointmentStatus.CANCELLED
        : UPCOMING.includes(appointment.status);
    const { client } = appointment;
    if (!expected || !client.clientAccountId || client.deletedAt) return false;

    const sender =
      company === undefined
        ? await this.sendingCompany(appointment.companyId)
        : company;
    if (!sender) return false;
    const settings = await this.autoMessageService.findOne(sender.id, kind);
    if (!settings.enabled) return false;

    const body = renderMessage(settings.body, {
      nome: firstName(client.name),
      estabelecimento: sender.name,
      data: formatDayMonth(appointment.startAt, sender.timezone),
      hora: formatTime(appointment.startAt, sender.timezone),
      servico: appointment.service.name,
      profissional: appointment.professional.name,
    });
    return this.deliver({
      company: sender,
      kind,
      accountId: client.clientAccountId,
      dedupKey: appointmentDedupKey(kind, appointment, reminderOffset),
      body,
      url: APPOINTMENTS_PATH,
    });
  }

  /** Aniversário ou "sentimos sua falta" de um cliente da clínica. */
  async sendToPerson(
    kind: Extract<AutoMessageKind, "BIRTHDAY" | "MISS_YOU">,
    company: SendingCompany,
    person: { name: string; clientAccountId: string },
    body: string,
    dedupKey: string,
  ): Promise<boolean> {
    return this.deliver({
      company,
      kind,
      accountId: person.clientAccountId,
      dedupKey,
      body: renderMessage(body, {
        nome: firstName(person.name),
        estabelecimento: company.name,
      }),
    });
  }

  /**
   * Grava o registro antes de enviar: a chave única faz o segundo envio da
   * mesma mensagem parar aqui (o job rodando de novo, dois avisos ao mesmo
   * tempo). O título da notificação é o nome da clínica.
   */
  private async deliver(message: {
    company: SendingCompany;
    kind: ClientAutoMessageKind;
    accountId: string;
    dedupKey: string;
    body: string;
    url?: string;
  }): Promise<boolean> {
    try {
      await this.prisma.autoMessageLog.create({
        data: {
          companyId: message.company.id,
          kind: message.kind,
          dedupKey: message.dedupKey,
          clientAccountId: message.accountId,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) return false;
      throw error;
    }
    await this.notifier.notify({
      accountId: message.accountId,
      companyId: message.company.id,
      kind: NOTICE_KIND[message.kind],
      title: message.company.name,
      body: message.body,
      url: message.url,
    });
    return true;
  }
}

/**
 * Chave do envio de um agendamento. A data do horário entra no lembrete e na
 * mudança: remarcado, ganha lembretes novos, e cada mudança tem o seu aviso.
 */
export function appointmentDedupKey(
  kind: AppointmentKind,
  { id, startAt }: { id: string; startAt: Date },
  reminderOffset?: number,
): string {
  const when = startAt.toISOString();
  switch (kind) {
    case "REMINDER":
      return `reminder:${id}:${reminderOffset ?? 0}:${when}`;
    case "APPOINTMENT_CREATED":
      return `created:${id}`;
    case "APPOINTMENT_RESCHEDULED":
      return `rescheduled:${id}:${when}`;
    case "APPOINTMENT_CANCELLED":
      return `cancelled:${id}`;
  }
}
