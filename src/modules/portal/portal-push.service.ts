import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ClientNotifierService } from "./client-notifier.service";
import type { PortalAccount } from "./portal-auth.service";
import {
  isPushServiceEndpoint,
  PushSenderService,
} from "./push-sender.service";
import type { PushPreferencesDto } from "./dto/push-preferences.dto";
import type { PushSubscriptionDto } from "./dto/push-subscription.dto";

const PUSH_DISABLED = "Os avisos do app não estão disponíveis no momento";

/**
 * Avisos do app do lado do cliente: inscrição do aparelho, interruptores, aviso
 * de teste e a caixa de Avisos (ver docs/business-rules.md, "Avisos do app").
 */
@Injectable()
export class PortalPushService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pushSender: PushSenderService,
    private readonly notifier: ClientNotifierService,
  ) {}

  /** A chave pública (nula com o push desligado no servidor) e os interruptores. */
  async info(account: PortalAccount) {
    const found = await this.prisma.clientAccount.findUniqueOrThrow({
      where: { id: account.accountId },
      select: { notifyAppointments: true, notifyPromotions: true },
    });
    return { publicKey: this.pushSender.publicKey, ...found };
  }

  /**
   * Ativa os avisos neste aparelho. O endereço é único por aparelho: se já
   * existir (outra conta entrou antes no mesmo celular), passa para esta conta
   * e esta sessão.
   */
  async subscribe(
    account: PortalAccount,
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
      clientAccountId: account.accountId,
      portalSessionId: account.sessionId,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      userAgent: userAgent?.slice(0, 300),
    };
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { endpoint: dto.endpoint, ...data },
      update: data,
    });
  }

  /** Desativa neste aparelho (só a inscrição da própria conta). */
  async unsubscribe(account: PortalAccount, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({
      where: { endpoint, clientAccountId: account.accountId },
    });
  }

  async updatePreferences(account: PortalAccount, dto: PushPreferencesDto) {
    return this.prisma.clientAccount.update({
      where: { id: account.accountId },
      data: {
        notifyAppointments: dto.notifyAppointments,
        notifyPromotions: dto.notifyPromotions,
        updatedAt: new Date(),
      },
      select: { notifyAppointments: true, notifyPromotions: true },
    });
  }

  /** Aviso de teste para os aparelhos da conta: confere a instalação. */
  async sendTest(account: PortalAccount) {
    if (!this.pushSender.enabled) {
      throw new ServiceUnavailableException(PUSH_DISABLED);
    }
    const { devices } = await this.notifier.notify({
      accountId: account.accountId,
      companyId: null,
      kind: "TEST",
      title: "Orari",
      body: "Tudo certo: os avisos estão chegando neste aparelho.",
    });
    return { devices };
  }

  /** A caixa de Avisos, dos mais novos aos mais antigos, com a clínica de cada um. */
  async messages(account: PortalAccount, page: number, limit: number) {
    const where = { clientAccountId: account.accountId };
    const [items, total, unread] = await Promise.all([
      this.prisma.clientMessage.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          kind: true,
          title: true,
          body: true,
          url: true,
          readAt: true,
          createdAt: true,
          company: {
            select: { fantasyName: true, corporateReason: true, logoUrl: true },
          },
        },
      }),
      this.prisma.clientMessage.count({ where }),
      this.unreadCount(account.accountId),
    ]);
    return {
      items: items.map(({ company, ...message }) => ({
        ...message,
        place: company
          ? {
              // O mesmo nome exibido no app (nome fantasia ou razão social).
              name: company.fantasyName ?? company.corporateReason,
              logoUrl: company.logoUrl,
            }
          : null,
      })),
      total,
      unread,
      page,
      limit,
    };
  }

  /** Marca todos como lidos (o app chama ao abrir a caixa de Avisos). */
  async markAllRead(account: PortalAccount): Promise<void> {
    await this.prisma.clientMessage.updateMany({
      where: { clientAccountId: account.accountId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /**
   * Limpa a caixa de Avisos (o "Limpar" do app): apaga os avisos da conta. Não
   * mexe na clínica: o "Recebida por N" das mensagens enviadas fica gravado na
   * campanha, e o registro que impede repetir os automáticos é outra tabela.
   */
  async clearMessages(account: PortalAccount): Promise<void> {
    await this.prisma.clientMessage.deleteMany({
      where: { clientAccountId: account.accountId },
    });
  }

  unreadCount(accountId: string): Promise<number> {
    return this.prisma.clientMessage.count({
      where: { clientAccountId: accountId, readAt: null },
    });
  }
}
