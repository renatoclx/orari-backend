import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import {
  AppointmentCancelReason,
  AppointmentStatus,
} from "../../../generated/prisma/enums";
import {
  APPOINTMENT_EVENTS,
  type AppointmentEvent,
  type ClassSessionCancelledEvent,
} from "../../common/events/appointment-events";
import { PrismaService } from "../../prisma/prisma.service";
import {
  AutoMessageSender,
  type AppointmentKind,
} from "./auto-message-sender.service";

/**
 * Escuta o que a clínica fez nos agendamentos e manda a mensagem da situação.
 * Roda fora da requisição (`async`): quem salvou o agendamento não espera nem
 * vê a falha de um aviso, que vai para o log.
 */
@Injectable()
export class AutoMessageListener {
  private readonly logger = new Logger(AutoMessageListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: AutoMessageSender,
  ) {}

  @OnEvent(APPOINTMENT_EVENTS.created, { async: true })
  onCreated({ appointmentId }: AppointmentEvent) {
    return this.send("APPOINTMENT_CREATED", appointmentId);
  }

  @OnEvent(APPOINTMENT_EVENTS.rescheduled, { async: true })
  onRescheduled({ appointmentId }: AppointmentEvent) {
    return this.send("APPOINTMENT_RESCHEDULED", appointmentId);
  }

  @OnEvent(APPOINTMENT_EVENTS.cancelled, { async: true })
  onCancelled({ appointmentId }: AppointmentEvent) {
    return this.send("APPOINTMENT_CANCELLED", appointmentId);
  }

  /** Sessão de turma cancelada: o aviso vai a cada aluno que ela tinha. */
  @OnEvent(APPOINTMENT_EVENTS.classSessionCancelled, { async: true })
  async onClassSessionCancelled({
    classSessionId,
    companyId,
  }: ClassSessionCancelledEvent) {
    try {
      const appointments = await this.prisma.appointment.findMany({
        where: {
          classSessionId,
          companyId,
          status: AppointmentStatus.CANCELLED,
          cancelReason: AppointmentCancelReason.CLASS_SESSION_CANCELLED,
        },
        select: { id: true },
      });
      const company = await this.sender.sendingCompany(companyId);
      for (const { id } of appointments) {
        await this.sender.sendForAppointment("APPOINTMENT_CANCELLED", id, {
          company,
        });
      }
    } catch (error) {
      this.fail(`sessão de turma ${classSessionId}`, error);
    }
  }

  private async send(kind: AppointmentKind, appointmentId: string) {
    try {
      await this.sender.sendForAppointment(kind, appointmentId);
    } catch (error) {
      this.fail(`${kind} do agendamento ${appointmentId}`, error);
    }
  }

  private fail(what: string, error: unknown) {
    this.logger.error(
      `Mensagem automática não enviada (${what})`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}
