import { Injectable, Logger } from "@nestjs/common";
import type { NotificationCategory } from "../../../generated/prisma/enums";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import {
  PushSenderService,
  type PushPayload,
} from "../portal/push-sender.service";
import { DEFAULT_PUSH } from "./notification.catalog";

/** O que uma fonte de aviso pede ao despachante. */
export interface NotifyInput {
  companyId: string;
  /** Os destinatários (cada um recebe a sua cópia na caixa). */
  userIds: string[];
  category: NotificationCategory;
  title: string;
  body: string;
  /** Caminho aberto ao tocar (do painel ou do app). */
  url?: string;
  /**
   * Identifica o evento: o mesmo evento para o mesmo usuário grava uma
   * notificação só, mesmo que a fonte repita (job rodando de novo).
   */
  dedupeKey: string;
  /**
   * Texto do push, quando difere do da caixa. A tela bloqueada do celular é
   * pública: o push leva o aviso genérico, sem o nome do cliente.
   */
  push?: { title: string; body: string };
}

/**
 * O ponto único de envio de notificações a usuários do sistema: grava na caixa
 * (sempre) e, se o usuário quiser e tiver aparelho, manda o push. Quem avisa
 * não sabe de canal nenhum, e um canal novo (WhatsApp) entra aqui.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushSender: PushSenderService,
  ) {}

  /** Devolve quantos usuários receberam um aviso novo (os repetidos não contam). */
  async notify(input: NotifyInput): Promise<number> {
    const userIds = [...new Set(input.userIds)];
    if (userIds.length === 0) return 0;

    // Só usuários ativos da empresa: excluído ou de outra empresa não recebe.
    const active = await this.prisma.user.findMany({
      where: {
        id: { in: userIds },
        companyId: input.companyId,
        deletedAt: null,
      },
      select: { id: true },
    });
    let created = 0;
    for (const { id: userId } of active) {
      if (await this.store(userId, input)) {
        created += 1;
        await this.push(userId, input);
      }
    }
    return created;
  }

  // Grava na caixa; falso quando o evento já tinha sido gravado.
  private async store(userId: string, input: NotifyInput): Promise<boolean> {
    try {
      await this.prisma.userNotification.create({
        data: {
          companyId: input.companyId,
          userId,
          category: input.category,
          title: input.title,
          body: input.body,
          url: input.url,
          dedupeKey: input.dedupeKey,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) return false;
      throw error;
    }
  }

  // O push de um usuário aos aparelhos dele. Falha de push nunca derruba a
  // notificação: já está na caixa.
  private async push(userId: string, input: NotifyInput): Promise<void> {
    if (!this.pushSender.enabled) return;
    try {
      const preference =
        await this.prisma.userNotificationPreference.findUnique({
          where: { userId_category: { userId, category: input.category } },
          select: { push: true },
        });
      if (!(preference?.push ?? DEFAULT_PUSH)) return;

      const devices = await this.prisma.userPushSubscription.findMany({
        where: { userId },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
      });
      const payload: PushPayload = {
        title: input.push?.title ?? input.title,
        body: input.push?.body ?? input.body,
        url: input.url ?? "/",
      };
      for (const device of devices) {
        const result = await this.pushSender.send(device, payload);
        // O aparelho deixou de existir: a inscrição sai.
        if (result === "gone") {
          await this.prisma.userPushSubscription.deleteMany({
            where: { id: device.id },
          });
        }
      }
    } catch (error) {
      this.logger.warn(
        `Push para o usuário ${userId} falhou: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
