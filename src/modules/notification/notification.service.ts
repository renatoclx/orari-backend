import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { NotificationCategory } from "../../../generated/prisma/enums";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import type { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { PushSubscriptionDto } from "../portal/dto/push-subscription.dto";
import {
  isPushServiceEndpoint,
  PushSenderService,
} from "../portal/push-sender.service";
import type { FindNotificationsQueryDto } from "./dto/find-notifications-query.dto";
import type { UpdateNotificationPreferencesDto } from "./dto/notification-preferences.dto";
import { categoriesFor, DEFAULT_PUSH } from "./notification.catalog";

const PUSH_DISABLED = "Os avisos no celular não estão disponíveis no momento";

const itemSelect = {
  id: true,
  category: true,
  title: true,
  body: true,
  url: true,
  readAt: true,
  createdAt: true,
} as const;

/**
 * A caixa de notificações do próprio usuário (o sino), as preferências de push
 * e os aparelhos dele. Tudo parte do usuário logado: ninguém lê nem altera a
 * caixa de outro.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pushSender: PushSenderService,
  ) {}

  /** As notificações dele, das mais novas às mais antigas, com quantas não leu. */
  async findAll(
    user: AuthenticatedUser,
    { page, limit, onlyUnread }: FindNotificationsQueryDto,
  ) {
    const where = {
      userId: user.id,
      clearedAt: null,
      ...(onlyUnread && { readAt: null }),
    };
    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.userNotification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: itemSelect,
      }),
      this.prisma.userNotification.count({ where }),
      this.prisma.userNotification.count({
        where: { userId: user.id, clearedAt: null, readAt: null },
      }),
    ]);
    const result: PaginatedResult<(typeof items)[number]> & { unread: number } =
      { items, total, page, limit, unread };
    return result;
  }

  /**
   * O número do sino e quando chegou a notificação mais nova (sem as limpas):
   * o painel compara com a que já viu para mostrar o aviso na tela.
   */
  async unreadCount(
    user: AuthenticatedUser,
  ): Promise<{ unread: number; latestAt: Date | null }> {
    const [unread, latest] = await this.prisma.$transaction([
      this.prisma.userNotification.count({
        where: { userId: user.id, clearedAt: null, readAt: null },
      }),
      this.prisma.userNotification.findFirst({
        where: { userId: user.id, clearedAt: null },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);
    return { unread, latestAt: latest?.createdAt ?? null };
  }

  /** Marca uma como lida (a de outro usuário responde 404, como a inexistente). */
  async markAsRead(user: AuthenticatedUser, id: string): Promise<void> {
    const { count } = await this.prisma.userNotification.updateMany({
      where: { id, userId: user.id, clearedAt: null },
      data: { readAt: new Date() },
    });
    if (count === 0) {
      throw new NotFoundException("Notificação não encontrada");
    }
  }

  /** Marca todas as não lidas dele. */
  async markAllAsRead(user: AuthenticatedUser): Promise<void> {
    await this.prisma.userNotification.updateMany({
      where: { userId: user.id, clearedAt: null, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /**
   * Limpa a caixa dele: tudo some da lista e do contador. A linha fica (só ganha
   * `clearedAt`), para a chave de deduplicação continuar valendo.
   */
  async clearAll(user: AuthenticatedUser): Promise<void> {
    await this.prisma.userNotification.updateMany({
      where: { userId: user.id, clearedAt: null },
      data: { clearedAt: new Date() },
    });
  }

  /** O push de cada categoria (sem linha, vale o padrão) e a chave pública do push. */
  async preferences(user: AuthenticatedUser) {
    const rows = await this.prisma.userNotificationPreference.findMany({
      where: { userId: user.id },
      select: { category: true, push: true },
    });
    const byCategory = new Map(rows.map((row) => [row.category, row.push]));
    return {
      publicKey: this.pushSender.publicKey,
      // Só as categorias do tipo de usuário (o lembrete e o resumo são do profissional).
      preferences: categoriesFor(user.type).map((category) => ({
        category,
        push: byCategory.get(category) ?? DEFAULT_PUSH,
      })),
    };
  }

  /** Grava só as categorias enviadas (cada uma no máximo uma vez). */
  async updatePreferences(
    user: AuthenticatedUser,
    dto: UpdateNotificationPreferencesDto,
  ) {
    const categories = dto.preferences.map((item) => item.category);
    if (new Set(categories).size !== categories.length) {
      throw new BadRequestException("Categoria repetida");
    }
    const allowed = categoriesFor(user.type);
    if (categories.some((category) => !allowed.includes(category))) {
      throw new BadRequestException("Categoria inválida para este usuário");
    }
    await this.prisma.$transaction(
      dto.preferences.map(({ category, push }) =>
        this.prisma.userNotificationPreference.upsert({
          where: { userId_category: { userId: user.id, category } },
          create: { userId: user.id, category, push },
          update: { push },
        }),
      ),
    );
    return this.preferences(user);
  }

  /**
   * Ativa o push neste aparelho. O endereço é único: se já existir (outro
   * usuário entrou antes no mesmo aparelho), passa para este usuário.
   */
  async subscribe(
    user: AuthenticatedUser,
    dto: PushSubscriptionDto,
    userAgent?: string,
  ): Promise<void> {
    if (!this.pushSender.enabled) {
      throw new ServiceUnavailableException(PUSH_DISABLED);
    }
    if (!isPushServiceEndpoint(dto.endpoint)) {
      throw new BadRequestException(
        "Endereço de push não reconhecido; use um navegador atualizado",
      );
    }
    const data = {
      userId: user.id,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      userAgent: userAgent?.slice(0, 300),
    };
    const known = await this.prisma.userPushSubscription.findUnique({
      where: { endpoint: dto.endpoint },
      select: { userId: true },
    });
    await this.prisma.userPushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { endpoint: dto.endpoint, ...data },
      update: data,
    });
    // Aparelho novo para este usuário: confirma com um aviso ("Avisos ativados").
    // O app reenvia a inscrição a cada abertura; só a primeira vale a confirmação.
    // Falha de envio não derruba a ativação.
    if (known?.userId !== user.id) {
      await this.pushSender
        .send(
          {
            endpoint: dto.endpoint,
            p256dh: dto.keys.p256dh,
            auth: dto.keys.auth,
          },
          {
            title: "Avisos ativados",
            body: "Você vai receber os avisos do Orari neste aparelho.",
            url: "/app/menu/notificacoes",
          },
        )
        .catch(() => undefined);
    }
  }

  /** Desativa neste aparelho (só a inscrição do próprio usuário). */
  async unsubscribe(user: AuthenticatedUser, endpoint: string): Promise<void> {
    await this.prisma.userPushSubscription.deleteMany({
      where: { endpoint, userId: user.id },
    });
  }
}

export type { NotificationCategory };
