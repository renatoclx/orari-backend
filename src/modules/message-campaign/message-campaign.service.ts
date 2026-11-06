import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { PeopleType } from "../../../generated/prisma/enums";
import { zonedToUtc } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { localDate } from "../auto-message/auto-message-schedule";
import { AutoMessageSender } from "../auto-message/auto-message-sender.service";
import { firstName, renderMessage } from "../auto-message/auto-message-text";
import { ClientNotifierService } from "../portal/client-notifier.service";
import type { CreateMessageCampaignDto } from "./dto/create-message-campaign.dto";

// Variáveis da mensagem da clínica (não há agendamento: só o cliente e o local).
const VARIABLES = ["nome", "estabelecimento"];
const VARIABLE = /\{([^{}\s]+)\}/g;

// Envios ao mesmo tempo: o bastante para não demorar, sem sobrecarregar.
const BATCH = 10;

// Cliente da clínica que recebe: ativo e com conta no app.
const RECEIVES = {
  type: PeopleType.CLIENT,
  deletedAt: null,
  clientAccountId: { not: null },
} as const;

/**
 * Mensagens → Enviar (ver docs/business-rules.md, "Mensagens da clínica"): a
 * clínica escreve e envia a todos os clientes com o app, uma vez por dia.
 */
@Injectable()
export class MessageCampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autoMessageSender: AutoMessageSender,
    private readonly notifier: ClientNotifierService,
  ) {}

  /** Quantos clientes têm o app e quantos desligaram as novidades e promoções. */
  async audience(companyId: string) {
    const [clients, promotionsOff, sentToday] = await Promise.all([
      this.prisma.people.count({ where: { companyId, ...RECEIVES } }),
      this.prisma.people.count({
        where: {
          companyId,
          ...RECEIVES,
          clientAccount: { notifyPromotions: false },
        },
      }),
      this.sentToday(companyId),
    ]);
    return { clients, promotionsOff, canSendToday: !sentToday };
  }

  async findAll(companyId: string, page: number, limit: number) {
    const where = { companyId };
    const [items, total] = await Promise.all([
      this.prisma.messageCampaign.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          title: true,
          body: true,
          recipients: true,
          createdAt: true,
          createdBy: { select: { name: true } },
        },
      }),
      this.prisma.messageCampaign.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  /**
   * Envia a todos os clientes com o app. O registro nasce numa transação
   * travada por clínica: dois cliques ao mesmo tempo não passam juntos da
   * regra de "uma por dia". Depois, envia e grava quantos receberam.
   */
  async send(companyId: string, userId: string, dto: CreateMessageCampaignDto) {
    const unknown = [
      ...new Set(
        [...`${dto.title} ${dto.body}`.matchAll(VARIABLE)]
          .map((match) => match[1])
          .filter((name) => !VARIABLES.includes(name)),
      ),
    ];
    if (unknown.length > 0) {
      throw new BadRequestException(
        `${unknown.map((name) => `{${name}}`).join(", ")} não existe nesta mensagem. Use {nome} ou {estabelecimento}.`,
      );
    }

    const company = await this.autoMessageSender.sendingCompany(companyId);
    if (!company) {
      throw new ConflictException(
        "O portal do cliente está desligado: ligue o portal para enviar mensagens",
      );
    }

    const campaign = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`message-campaign:${companyId}`}))`;
      if (await this.sentToday(companyId, tx)) {
        throw new ConflictException(
          "Hoje já foi enviada uma mensagem. A próxima pode ser enviada amanhã.",
        );
      }
      return tx.messageCampaign.create({
        data: {
          companyId,
          createdById: userId,
          title: dto.title,
          body: dto.body,
        },
      });
    });

    const people = await this.prisma.people.findMany({
      where: { companyId, ...RECEIVES },
      select: { name: true, clientAccountId: true },
    });
    let recipients = 0;
    for (let start = 0; start < people.length; start += BATCH) {
      const results = await Promise.all(
        people.slice(start, start + BATCH).map((person) => {
          const values = {
            nome: firstName(person.name),
            estabelecimento: company.name,
          };
          return this.notifier.notify({
            accountId: person.clientAccountId as string,
            companyId,
            kind: "CAMPAIGN",
            title: renderMessage(dto.title, values),
            body: renderMessage(dto.body, values),
          });
        }),
      );
      recipients += results.filter((result) => result.saved).length;
    }

    return this.prisma.messageCampaign.update({
      where: { id: campaign.id },
      data: { recipients },
      select: {
        id: true,
        title: true,
        body: true,
        recipients: true,
        createdAt: true,
      },
    });
  }

  /** Já houve envio hoje, no dia do relógio da clínica? */
  private async sentToday(
    companyId: string,
    db: Pick<PrismaService, "company" | "messageCampaign"> = this.prisma,
  ): Promise<boolean> {
    const { timezone } = await db.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timezone: true },
    });
    const [year, month, day] = localDate(new Date(), timezone)
      .split("-")
      .map(Number);
    const startOfToday = zonedToUtc(
      { year, month, day, hours: 0, minutes: 0 },
      timezone,
    );
    const count = await db.messageCampaign.count({
      where: { companyId, createdAt: { gte: startOfToday } },
    });
    return count > 0;
  }
}
