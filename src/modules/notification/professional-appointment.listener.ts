import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { UserType } from "../../../generated/prisma/enums";
import {
  APPOINTMENT_EVENTS,
  type AppointmentEvent,
  type ClassSessionCancelledEvent,
} from "../../common/events/appointment-events";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { dayOf, whenOf } from "./appointment-notifier.listener";
import { NotificationDispatcher } from "./notification-dispatcher.service";

type Kind = "created" | "rescheduled" | "cancelled";

/**
 * Avisa o profissional do que a clínica faz nos horários dele: marcou, mudou ou
 * cancelou (e a turma cancelada, uma vez só, não uma por aluno). Só chega a quem
 * usa o app (usuário PROFESSIONAL ligado ao profissional); o administrador, que
 * faz a ação, não é avisado. Roda fora da requisição (`async`).
 */
@Injectable()
export class ProfessionalAppointmentListener {
  private readonly logger = new Logger(ProfessionalAppointmentListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  @OnEvent(APPOINTMENT_EVENTS.created, { async: true })
  onCreated({ appointmentId }: AppointmentEvent) {
    return this.notify("created", appointmentId);
  }

  @OnEvent(APPOINTMENT_EVENTS.rescheduled, { async: true })
  onRescheduled({ appointmentId }: AppointmentEvent) {
    return this.notify("rescheduled", appointmentId);
  }

  @OnEvent(APPOINTMENT_EVENTS.cancelled, { async: true })
  onCancelled({ appointmentId }: AppointmentEvent) {
    return this.notify("cancelled", appointmentId);
  }

  /** Sessão de turma cancelada: um aviso para o profissional, não um por aluno. */
  @OnEvent(APPOINTMENT_EVENTS.classSessionCancelled, { async: true })
  async onClassSessionCancelled({
    classSessionId,
    companyId,
  }: ClassSessionCancelledEvent) {
    try {
      const session = await this.prisma.classSession.findFirst({
        where: { id: classSessionId, companyId },
        select: {
          professionalId: true,
          startAt: true,
          service: { select: { name: true } },
        },
      });
      if (!session) return;
      const timeZone = await this.companyService.getTimeZone(companyId);
      const when = whenOf(session.startAt, timeZone);
      await this.send(companyId, session.professionalId, {
        title: "Turma cancelada",
        body: `A turma de ${session.service.name} de ${when} foi cancelada.`,
        push: {
          title: "Turma cancelada",
          body: `A turma de ${when} foi cancelada.`,
        },
        url: `/app/agenda?dia=${dayOf(session.startAt, timeZone)}`,
        dedupeKey: `class-session:${classSessionId}:cancelled`,
      });
    } catch (error) {
      this.fail(`sessão de turma ${classSessionId}`, error);
    }
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
          service: { select: { name: true } },
        },
      });
      if (!appointment) return;
      const timeZone = await this.companyService.getTimeZone(
        appointment.companyId,
      );
      const when = whenOf(appointment.startAt, timeZone);
      const who = `${appointment.client.name} (${appointment.service.name})`;
      const texts = {
        created: {
          title: "Novo agendamento",
          body: `${who}: ${when}.`,
          push: `Novo horário em ${when}.`,
          key: `appointment:${appointmentId}:created`,
        },
        rescheduled: {
          title: "Agendamento remarcado",
          body: `${who} agora é em ${when}.`,
          push: `Um horário seu foi remarcado para ${when}.`,
          // Cada remarcação tem o seu aviso: a chave leva o novo horário.
          key: `appointment:${appointmentId}:rescheduled:${appointment.startAt.getTime()}`,
        },
        cancelled: {
          title: "Agendamento cancelado",
          body: `A clínica cancelou ${who} de ${when}.`,
          push: `O horário de ${when} foi cancelado.`,
          key: `appointment:${appointmentId}:cancelled`,
        },
      }[kind];

      await this.send(appointment.companyId, appointment.professionalId, {
        title: texts.title,
        body: texts.body,
        push: { title: texts.title, body: texts.push },
        url: `/app/agenda?dia=${dayOf(appointment.startAt, timeZone)}`,
        dedupeKey: texts.key,
      });
    } catch (error) {
      this.fail(`${kind} do agendamento ${appointmentId}`, error);
    }
  }

  // O usuário (só do tipo PROFESSIONAL) ligado ao profissional do horário.
  private async send(
    companyId: string,
    professionalId: string,
    message: {
      title: string;
      body: string;
      push: { title: string; body: string };
      url: string;
      dedupeKey: string;
    },
  ): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: {
        companyId,
        deletedAt: null,
        type: UserType.PROFESSIONAL,
        peopleId: professionalId,
      },
      select: { id: true },
    });
    await this.dispatcher.notify({
      companyId,
      userIds: users.map((user) => user.id),
      category: "APPOINTMENT",
      ...message,
    });
  }

  private fail(what: string, error: unknown): void {
    this.logger.warn(
      `Aviso ao profissional (${what}) falhou: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
