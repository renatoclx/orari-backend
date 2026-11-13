import { BadRequestException, Injectable } from "@nestjs/common";
import type { AutoMessageKind } from "../../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import {
  AUTO_MESSAGE_KINDS,
  defaultSettings,
  type AutoMessageSettings,
} from "./auto-message.catalog";
import { unknownVariables } from "./auto-message-text";
import type { UpdateAutoMessagesDto } from "./dto/update-auto-messages.dto";

// Nome de cada situação nas mensagens de erro.
const KIND_LABEL: Record<AutoMessageKind, string> = {
  REMINDER: "Lembrete",
  APPOINTMENT_CREATED: "Agendamento marcado",
  APPOINTMENT_RESCHEDULED: "Agendamento alterado",
  APPOINTMENT_CANCELLED: "Agendamento cancelado",
  BIRTHDAY: "Aniversário",
  MISS_YOU: "Sentimos sua falta",
  PROFESSIONAL_REMINDER: "Lembrete do profissional",
  PROFESSIONAL_SUMMARY: "Resumo da manhã do profissional",
};

const SELECT = {
  kind: true,
  enabled: true,
  body: true,
  reminderOffsets: true,
  missYouDays: true,
} as const;

/**
 * Configuração das mensagens automáticas de uma clínica (ver
 * docs/business-rules/mensagens.md, "Mensagens automáticas"). Quem nunca salvou recebe
 * os padrões do catálogo.
 */
@Injectable()
export class AutoMessageService {
  constructor(private readonly prisma: PrismaService) {}

  /** As oito situações, na ordem do catálogo. */
  async findAll(companyId: string): Promise<AutoMessageSettings[]> {
    const rows = await this.prisma.autoMessage.findMany({
      where: { companyId },
      select: SELECT,
    });
    const byKind = new Map(rows.map((row) => [row.kind, row]));
    return AUTO_MESSAGE_KINDS.map(
      (kind) => byKind.get(kind) ?? defaultSettings(kind),
    );
  }

  /** Uma situação (a gravada ou o padrão), para o envio. */
  async findOne(
    companyId: string,
    kind: AutoMessageKind,
  ): Promise<AutoMessageSettings> {
    const row = await this.prisma.autoMessage.findUnique({
      where: { companyId_kind: { companyId, kind } },
      select: SELECT,
    });
    return row ?? defaultSettings(kind);
  }

  /** Grava as situações enviadas (tudo ou nada) e devolve as oito. */
  async replace(
    companyId: string,
    dto: UpdateAutoMessagesDto,
  ): Promise<AutoMessageSettings[]> {
    const kinds = dto.items.map((item) => item.kind);
    if (new Set(kinds).size !== kinds.length) {
      throw new BadRequestException("Cada situação pode vir uma vez só");
    }
    for (const item of dto.items) {
      const label = KIND_LABEL[item.kind];
      const unknown = unknownVariables(item.body, item.kind);
      if (unknown.length > 0) {
        throw new BadRequestException(
          `${label}: ${unknown.map((name) => `{${name}}`).join(", ")} não existe nesta mensagem`,
        );
      }
      if (
        item.kind === "REMINDER" &&
        item.enabled &&
        !item.reminderOffsets?.length
      ) {
        throw new BadRequestException(
          "Lembrete: escolha ao menos um tempo antes do horário",
        );
      }
    }

    await this.prisma.$transaction(
      dto.items.map((item) => {
        const defaults = defaultSettings(item.kind);
        const data = {
          enabled: item.enabled,
          body: item.body,
          // Cada situação guarda só a opção dela; as outras ficam no padrão.
          reminderOffsets:
            item.kind === "REMINDER"
              ? [...(item.reminderOffsets ?? [])].sort((a, b) => b - a)
              : [],
          missYouDays:
            item.kind === "MISS_YOU"
              ? (item.missYouDays ?? defaults.missYouDays)
              : null,
        };
        return this.prisma.autoMessage.upsert({
          where: { companyId_kind: { companyId, kind: item.kind } },
          create: { companyId, kind: item.kind, ...data },
          update: { ...data, updatedAt: new Date() },
        });
      }),
    );
    return this.findAll(companyId);
  }
}
