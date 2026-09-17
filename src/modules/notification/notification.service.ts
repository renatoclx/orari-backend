import { Injectable, NotFoundException } from "@nestjs/common";
import { Notification, Prisma } from "../../../generated/prisma/client";
import { NotificationType } from "../../../generated/prisma/enums";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { RecurringAppointmentService } from "../recurring-appointment/recurring-appointment.service";
import { FindNotificationsQueryDto } from "./dto/find-notifications-query.dto";

/**
 * Avisos para a empresa agir. Hoje existe um tipo: a recorrência está chegando ao
 * fim dos agendamentos já gerados e precisa ser estendida manualmente
 * (POST /recurring-appointments/:id/extend).
 *
 * Não há rotina agendada no projeto. A lista de notificações é sincronizada a
 * cada consulta: cria o que falta e resolve o que já foi atendido. Assim o aviso
 * aparece sem depender de um agendador, e some sozinho depois da extensão.
 *
 * Notificações não são excluídas: ficam resolvidas (resolvedAt).
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recurringAppointmentService: RecurringAppointmentService,
  ) {}

  async findAll(
    { page, limit, onlyUnread, includeResolved }: FindNotificationsQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<Notification>> {
    await this.syncRecurringHorizon(companyId);

    const where: Prisma.NotificationWhereInput = {
      companyId,
      resolvedAt: includeResolved ? undefined : null,
      readAt: onlyUnread ? null : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async markAsRead(id: string, companyId: string): Promise<Notification> {
    await this.findOne(id, companyId);

    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date(), updatedAt: new Date() },
    });
  }

  async findOne(id: string, companyId: string): Promise<Notification> {
    const notification = await this.prisma.notification.findFirst({
      where: { id, companyId },
    });

    if (!notification) {
      throw new NotFoundException("Notificação não encontrada");
    }

    return notification;
  }

  /**
   * Compara as recorrências que precisam de extensão com as notificações abertas:
   * cria as que faltam e resolve as que não são mais necessárias (a recorrência
   * foi estendida, desativada ou chegou ao fim).
   */
  private async syncRecurringHorizon(companyId: string): Promise<void> {
    const needing =
      await this.recurringAppointmentService.findNeedingExtension(companyId);
    const needingIds = needing.map((recurrence) => recurrence.id);

    const open = await this.prisma.notification.findMany({
      where: {
        companyId,
        type: NotificationType.RECURRING_APPOINTMENT_HORIZON,
        resolvedAt: null,
      },
      select: { id: true, recurringAppointmentId: true },
    });
    const alreadyNotified = open
      .map((notification) => notification.recurringAppointmentId)
      .filter((id): id is string => id !== null);

    const obsolete = open
      .filter(
        (notification) =>
          !notification.recurringAppointmentId ||
          !needingIds.includes(notification.recurringAppointmentId),
      )
      .map((notification) => notification.id);

    const created = needing.filter(
      (recurrence) => !alreadyNotified.includes(recurrence.id),
    );

    if (obsolete.length === 0 && created.length === 0) {
      return;
    }

    await this.prisma.$transaction([
      this.prisma.notification.updateMany({
        where: { id: { in: obsolete } },
        data: { resolvedAt: new Date(), updatedAt: new Date() },
      }),
      this.prisma.notification.createMany({
        data: created.map(({ id, generatedUntil }) => ({
          companyId,
          type: NotificationType.RECURRING_APPOINTMENT_HORIZON,
          recurringAppointmentId: id,
          message: generatedUntil
            ? `Os agendamentos desta recorrência vão até ${generatedUntil.toISOString().slice(0, 10)}. Estenda para continuar a agenda.`
            : "Esta recorrência ainda não possui agendamentos gerados. Estenda para criar a agenda.",
        })),
      }),
    ]);
  }
}
