import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { UserType } from "../../../generated/prisma/enums";
import {
  APPOINTMENT_EVENTS,
  type AppointmentEvent,
} from "../../common/events/appointment-events";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { NotificationDispatcher } from "./notification-dispatcher.service";

type Kind = "created" | "cancelled";

/**
 * Avisa a equipe do que o cliente faz pelo app: quem tem acesso ao painel (os
 * ADMIN) e o profissional do horário, se ele usa o app. Roda fora da requisição
 * (`async`): quem marcou não espera nem vê a falha de um aviso.
 */
@Injectable()
export class AppointmentNotifierListener {
  private readonly logger = new Logger(AppointmentNotifierListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  @OnEvent(APPOINTMENT_EVENTS.createdByClient, { async: true })
  onCreated({ appointmentId }: AppointmentEvent) {
    return this.notify("created", appointmentId);
  }

  @OnEvent(APPOINTMENT_EVENTS.cancelledByClient, { async: true })
  onCancelled({ appointmentId }: AppointmentEvent) {
    return this.notify("cancelled", appointmentId);
  }

  private async notify(kind: Kind, appointmentId: string): Promise<void> {
    try {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          companyId: true,
          professionalId: true,
          startAt: true,
          client: { select: { name: true } },
          professional: { select: { name: true } },
          service: { select: { name: true } },
        },
      });
      if (!appointment) return;
      const { companyId } = appointment;
      const timeZone = await this.companyService.getTimeZone(companyId);
      const when = whenOf(appointment.startAt, timeZone);
      const day = dayOf(appointment.startAt, timeZone);

      // Quem recebe: os administradores e o usuário ligado ao profissional.
      const users = await this.prisma.user.findMany({
        where: {
          companyId,
          deletedAt: null,
          OR: [
            { type: UserType.ADMIN },
            { peopleId: appointment.professionalId },
          ],
        },
        select: { id: true, type: true },
      });
      const text = this.texts(kind, {
        client: appointment.client.name,
        service: appointment.service.name,
        professional: appointment.professional.name,
        when,
      });
      const dedupeKey = `appointment:${appointmentId}:${kind}-by-client`;

      // O ADMIN abre o painel; o profissional, o app (na agenda do dia).
      const admins = users.filter((user) => user.type === UserType.ADMIN);
      const professionals = users.filter(
        (user) => user.type !== UserType.ADMIN,
      );
      await this.dispatcher.notify({
        companyId,
        userIds: admins.map((user) => user.id),
        category: "APPOINTMENT",
        ...text,
        url: "/",
        dedupeKey,
      });
      await this.dispatcher.notify({
        companyId,
        userIds: professionals.map((user) => user.id),
        category: "APPOINTMENT",
        ...text,
        url: `/app/agenda?dia=${day}`,
        dedupeKey,
      });
    } catch (error) {
      this.logger.warn(
        `Aviso do agendamento ${appointmentId} (${kind}) falhou: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // O texto da caixa leva os nomes; o do push é genérico (tela bloqueada).
  private texts(
    kind: Kind,
    v: { client: string; service: string; professional: string; when: string },
  ) {
    return kind === "created"
      ? {
          title: "Novo agendamento pelo app",
          body: `${v.client} marcou ${v.service} com ${v.professional} em ${v.when}.`,
          push: {
            title: "Novo agendamento pelo app",
            body: `Horário marcado para ${v.when}.`,
          },
        }
      : {
          title: "Agendamento cancelado pelo cliente",
          body: `${v.client} cancelou ${v.service} com ${v.professional} (${v.when}).`,
          push: {
            title: "Agendamento cancelado pelo cliente",
            body: `O horário de ${v.when} foi cancelado.`,
          },
        };
  }
}

/** "14/11 às 09:00", no relógio da clínica. */
export function whenOf(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("day")}/${get("month")} às ${get("hour")}:${get("minute")}`;
}

/** "2026-11-14", o dia do horário no relógio da clínica (a agenda do app abre nele). */
export function dayOf(date: Date, timeZone: string): string {
  // O locale sv-SE escreve a data como AAAA-MM-DD.
  return new Intl.DateTimeFormat("sv-SE", { timeZone }).format(date);
}
