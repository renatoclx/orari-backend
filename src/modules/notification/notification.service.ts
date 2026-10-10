import { Injectable, NotFoundException } from "@nestjs/common";
import { Notification, Prisma } from "../../../generated/prisma/client";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { FindNotificationsQueryDto } from "./dto/find-notifications-query.dto";

/**
 * Avisos para a empresa agir. Ainda não há tipos em uso: a entidade é mantida
 * para implementações futuras.
 *
 * Notificações não são excluídas: ficam resolvidas (resolvedAt).
 */
@Injectable()
export class NotificationService {
  // Só depende do Prisma: sem sincronização com outros módulos, o serviço é só leitura e marcação.
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    { page, limit, onlyUnread, includeResolved }: FindNotificationsQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<Notification>> {
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
}
