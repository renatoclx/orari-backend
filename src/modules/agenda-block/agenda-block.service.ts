import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AppointmentStatus,
  AuditAction,
} from "../../../generated/prisma/enums";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { toZonedParts, zonedToUtc } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CompanyService } from "../company/company.service";
import { CreateAgendaBlockDto } from "./dto/create-agenda-block.dto";
import { FindAgendaBlocksQueryDto } from "./dto/find-agenda-blocks-query.dto";

// Resposta 409 de quando já há agendamentos no horário (a tela pede confirmação).
export const AGENDA_BLOCK_HAS_APPOINTMENTS = "AGENDA_BLOCK_HAS_APPOINTMENTS";

type Day = { year: number; month: number; day: number };

const parseDay = (value: string): Day => {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
};

const parseTime = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return { hours, minutes };
};

// O dia seguinte no calendário (para o fim de um período de dias).
const nextDay = ({ year, month, day }: Day): Day => {
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

/**
 * Horários bloqueados na agenda da empresa (ver docs/business-rules.md,
 * "Bloqueio de horários"). O bloqueio conta como fora do funcionamento: a
 * conferência fica em BusinessHourService.isWithinBusinessHours; aqui só se
 * cadastra, lista e desbloqueia.
 */
@Injectable()
export class AgendaBlockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
    private readonly auditService: AuditService,
  ) {}

  /** Os bloqueios do período (dias da empresa), do mais cedo ao mais tarde. */
  async findAll(
    { from, to }: FindAgendaBlocksQueryDto,
    companyId: string,
    now = new Date(),
  ) {
    const timeZone = await this.companyService.getTimeZone(companyId);
    // Sem `from`, a partir do começo de hoje no relógio da empresa.
    const firstDay = from ? parseDay(from) : toZonedParts(now, timeZone);
    const start = zonedToUtc({ ...firstDay, hours: 0, minutes: 0 }, timeZone);
    const end = to
      ? zonedToUtc({ ...nextDay(parseDay(to)), hours: 0, minutes: 0 }, timeZone)
      : undefined;

    return this.prisma.agendaBlock.findMany({
      where: {
        companyId,
        endAt: { gt: start },
        ...(end && { startAt: { lt: end } }),
      },
      orderBy: { startAt: "asc" },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        createdAt: true,
        createdBy: { select: { name: true } },
      },
    });
  }

  /**
   * Bloqueia um intervalo de um dia. Recusa: fim antes do início ou data
   * inexistente (400), horário que já começou (400), sobreposição a outro
   * bloqueio (409) e, sem `confirmed`, horário com agendamentos (409 com a
   * contagem, que continuam marcados se a clínica confirmar).
   */
  async create(
    dto: CreateAgendaBlockDto,
    currentUser: AuthenticatedUser,
    ip?: string,
    now = new Date(),
  ) {
    const { companyId } = currentUser;
    const timeZone = await this.companyService.getTimeZone(companyId);
    const day = parseDay(dto.date);
    const startAt = zonedToUtc(
      { ...day, ...parseTime(dto.startTime) },
      timeZone,
    );
    const endAt = zonedToUtc({ ...day, ...parseTime(dto.endTime) }, timeZone);

    // 2026-02-31 vira outro dia na conversão: a volta não bate.
    const back = toZonedParts(startAt, timeZone);
    if (
      back.year !== day.year ||
      back.month !== day.month ||
      back.day !== day.day
    ) {
      throw new BadRequestException("Data inválida");
    }
    if (endAt <= startAt) {
      throw new BadRequestException("O fim precisa ser depois do início");
    }
    if (startAt < now) {
      throw new BadRequestException(
        "Não é possível bloquear um horário que já começou",
      );
    }

    const overlap = { startAt: { lt: endAt }, endAt: { gt: startAt } };
    const [blocks, appointments] = await Promise.all([
      this.prisma.agendaBlock.count({ where: { companyId, ...overlap } }),
      this.prisma.appointment.count({
        where: {
          companyId,
          status: { not: AppointmentStatus.CANCELLED },
          ...overlap,
        },
      }),
    ]);
    if (blocks > 0) {
      throw new ConflictException("Já existe um bloqueio neste horário");
    }
    if (appointments > 0 && !dto.confirmed) {
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        code: AGENDA_BLOCK_HAS_APPOINTMENTS,
        message:
          appointments === 1
            ? "Há 1 agendamento neste horário. Ele continua marcado."
            : `Há ${appointments} agendamentos neste horário. Eles continuam marcados.`,
        appointments,
      });
    }

    const block = await this.prisma.$transaction(async (tx) => {
      const created = await tx.agendaBlock.create({
        data: { companyId, startAt, endAt, createdById: currentUser.id },
      });
      await this.auditService.record(
        {
          companyId,
          userId: currentUser.id,
          action: AuditAction.AGENDA_BLOCK_CREATED,
          entityType: "AGENDA_BLOCK",
          entityId: created.id,
          ip,
        },
        tx,
      );
      return created;
    });
    return { ...block, appointments };
  }

  /** Desbloqueia (apaga o bloqueio). O que já terminou fica como registro. */
  async remove(
    id: string,
    currentUser: AuthenticatedUser,
    ip?: string,
    now = new Date(),
  ): Promise<void> {
    const { companyId } = currentUser;
    const block = await this.prisma.agendaBlock.findFirst({
      where: { id, companyId },
      select: { id: true, endAt: true },
    });
    if (!block) {
      throw new NotFoundException("Bloqueio não encontrado");
    }
    if (block.endAt <= now) {
      throw new BadRequestException(
        "Este bloqueio já terminou e não pode ser desfeito",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.agendaBlock.delete({ where: { id } });
      await this.auditService.record(
        {
          companyId,
          userId: currentUser.id,
          action: AuditAction.AGENDA_BLOCK_REMOVED,
          entityType: "AGENDA_BLOCK",
          entityId: id,
          ip,
        },
        tx,
      );
    });
  }
}
