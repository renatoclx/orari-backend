import { Injectable, Logger } from "@nestjs/common";
import type { ClientMessageKind } from "../../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PushSenderService } from "./push-sender.service";

export interface ClientNotice {
  accountId: string;
  // Clínica que envia; nulo só no aviso de teste.
  companyId: string | null;
  kind: ClientMessageKind;
  title: string;
  body: string;
  // Caminho do app aberto ao tocar (padrão: a caixa de Avisos).
  url?: string;
}

export interface NoticeResult {
  // false: o cliente desligou esse tipo de aviso (nada foi gravado).
  saved: boolean;
  // Aparelhos para os quais o aviso saiu.
  devices: number;
}

export const MESSAGES_PATH = "/app/avisos";

// Interruptor do cliente que vale para cada tipo (o teste vale sempre).
const PREFERENCE: Record<
  ClientMessageKind,
  "notifyAppointments" | "notifyPromotions" | null
> = {
  REMINDER: "notifyAppointments",
  APPOINTMENT: "notifyAppointments",
  BIRTHDAY: "notifyPromotions",
  MISS_YOU: "notifyPromotions",
  CAMPAIGN: "notifyPromotions",
  TEST: null,
};

/**
 * Ponto único de aviso ao cliente do app: confere o interruptor, grava na caixa
 * de Avisos e envia para os aparelhos inscritos da conta (ver
 * docs/business-rules.md, "Avisos do app"). Nunca lança erro: um agendamento
 * salvo não pode falhar porque o aviso não saiu; a falha vai para o log.
 */
@Injectable()
export class ClientNotifierService {
  private readonly logger = new Logger("ClientNotifier");

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushSender: PushSenderService,
  ) {}

  async notify(notice: ClientNotice): Promise<NoticeResult> {
    try {
      return await this.deliver(notice);
    } catch (error) {
      this.logger.error(
        `Aviso ${notice.kind} não enviado à conta ${notice.accountId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { saved: false, devices: 0 };
    }
  }

  private async deliver(notice: ClientNotice): Promise<NoticeResult> {
    const preference = PREFERENCE[notice.kind];
    const account = await this.prisma.clientAccount.findUnique({
      where: { id: notice.accountId },
      select: { notifyAppointments: true, notifyPromotions: true },
    });
    if (!account || (preference && !account[preference])) {
      return { saved: false, devices: 0 };
    }

    const url = notice.url ?? MESSAGES_PATH;
    await this.prisma.clientMessage.create({
      data: {
        clientAccountId: notice.accountId,
        companyId: notice.companyId,
        kind: notice.kind,
        title: notice.title,
        body: notice.body,
        url,
      },
    });
    if (!this.pushSender.enabled) return { saved: true, devices: 0 };

    // Só aparelhos com a sessão em vigor: quem saiu ou teve a sessão
    // revogada (troca de senha) não recebe.
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: {
        clientAccountId: notice.accountId,
        portalSession: { revokedAt: null, expiresAt: { gt: new Date() } },
      },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    const results = await Promise.all(
      subscriptions.map((subscription) =>
        this.pushSender.send(subscription, {
          title: notice.title,
          body: notice.body,
          url,
        }),
      ),
    );

    const gone = subscriptions
      .filter((_, index) => results[index] === "gone")
      .map((subscription) => subscription.id);
    if (gone.length > 0) {
      await this.prisma.pushSubscription.deleteMany({
        where: { id: { in: gone } },
      });
    }
    return {
      saved: true,
      devices: results.filter((result) => result === "sent").length,
    };
  }
}
