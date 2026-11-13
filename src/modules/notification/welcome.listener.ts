import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { UserType } from "../../../generated/prisma/enums";
import {
  USER_EVENTS,
  type UserLoggedInEvent,
} from "../../common/events/user-events";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationDispatcher } from "./notification-dispatcher.service";

const TITLE = "Boas-vindas ao Orari!";

// O texto de cada tipo: a caixa explica o que vem e aonde ir; o push é só o convite.
const WELCOME = {
  [UserType.ADMIN]: {
    body: "Abra os primeiros passos para deixar a clínica pronta. Toda manhã você recebe o resumo das pendências do dia: em Mensagens → Ao administrador, escolha a hora e os itens.",
    url: "/dashboard?passos=1",
  },
  [UserType.PROFESSIONAL]: {
    body: "Aqui você acompanha a sua agenda, os seus clientes e as suas comissões. Em Menu → Avisos no celular, ative os avisos e escolha o que quer receber: o lembrete de cada atendimento e o resumo da manhã.",
    url: "/app/menu/notificacoes",
  },
} as const;

/**
 * Boas-vindas do primeiro acesso: quem entra pela primeira vez recebe uma
 * notificação (e o push, se tiver aparelho). A marca `welcomedAt` é gravada de
 * forma atômica antes de enviar, então duas entradas ao mesmo tempo (dois
 * aparelhos) mandam uma só. Quem já existia não recebe (a migração marcou).
 */
@Injectable()
export class WelcomeListener {
  private readonly logger = new Logger(WelcomeListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  @OnEvent(USER_EVENTS.loggedIn, { async: true })
  async onLoggedIn({ userId }: UserLoggedInEvent): Promise<void> {
    try {
      const claimed = await this.prisma.user.updateMany({
        where: { id: userId, welcomedAt: null, deletedAt: null },
        data: { welcomedAt: new Date() },
      });
      if (claimed.count === 0) return;

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { companyId: true, type: true },
      });
      if (!user) return;
      // O administrador da plataforma (SUPER_ADMIN) não tem as boas-vindas.
      const text =
        user.type === UserType.ADMIN || user.type === UserType.PROFESSIONAL
          ? WELCOME[user.type]
          : undefined;
      if (!text) return;

      await this.dispatcher.notify({
        companyId: user.companyId,
        userIds: [userId],
        category: "WELCOME",
        title: TITLE,
        body: text.body,
        url: text.url,
        dedupeKey: "welcome",
        push: { title: TITLE, body: "Toque para conhecer o Orari." },
      });
    } catch (error) {
      this.logger.warn(
        `Boas-vindas do usuário ${userId} falharam: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
