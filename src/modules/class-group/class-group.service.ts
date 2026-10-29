import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import {
  AppointmentStatus,
  PeopleType,
  WeekDay,
} from "../../../generated/prisma/enums";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { formatTimeOfDay, parseTimeOfDay } from "../../common/time/time-of-day";
import { zonedToUtc } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { BusinessHourService } from "../business-hour/business-hour.service";
import { CompanyService } from "../company/company.service";
import { PeopleService } from "../people/people.service";
import { ServiceService } from "../service/service.service";
import { ClassGroupDayDto } from "./dto/class-group-day.dto";
import { CreateClassGroupDto } from "./dto/create-class-group.dto";
import { FindClassGroupsQueryDto } from "./dto/find-class-groups-query.dto";
import { UpdateClassGroupDto } from "./dto/update-class-group.dto";
import {
  formatMinutes,
  formatZonedDateTime,
  minutesOf,
  WEEK_DAY_LABEL,
} from "./class-group-schedule";

// Serviço, profissional e dias vêm junto com a turma; a coluna de busca fica de fora.
const withDetails = {
  omit: { normalizedName: true },
  include: {
    service: {
      select: { id: true, name: true, color: true, duration: true },
    },
    professional: { select: { id: true, name: true, photoUrl: true } },
    days: {
      select: { weekDay: true, startTime: true },
      orderBy: [{ weekDay: "asc" }, { startTime: "asc" }],
    },
  },
} satisfies Prisma.ClassGroupDefaultArgs;

type ClassGroupWithDetails = Prisma.ClassGroupGetPayload<typeof withDetails>;

export interface ClassGroupDayResponse {
  weekDay: WeekDay;
  startTime: string;
  // Calculado: o início mais a duração do serviço.
  endTime: string;
}

export type ClassGroupResponse = Omit<ClassGroupWithDetails, "days"> & {
  days: ClassGroupDayResponse[];
};

// Horário de um dia da turma em minutos desde a meia-noite (o fim pode passar de 24h).
interface WeeklySlot {
  weekDay: WeekDay;
  start: number;
  end: number;
}

/**
 * Turmas fixas (ver docs/turmas.md): um horário semanal de atendimento em turma,
 * com vagas. Pertencem à empresa do usuário autenticado; as de outras empresas
 * se comportam como inexistentes (404). Só o ADMIN as gerencia (restrito no
 * controller).
 *
 * Serviço, profissional e dias não mudam depois do cadastro. Não há exclusão: a
 * turma é inativada e pode ser reativada.
 */
@Injectable()
export class ClassGroupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serviceService: ServiceService,
    private readonly peopleService: PeopleService,
    private readonly businessHourService: BusinessHourService,
    private readonly companyService: CompanyService,
  ) {}

  async create(
    dto: CreateClassGroupDto,
    companyId: string,
  ): Promise<ClassGroupResponse> {
    const { days, ...data } = dto;
    const duration = await this.ensureServiceAcceptsClasses(
      dto.serviceId,
      companyId,
    );
    await this.ensureProfessional(dto.professionalId, companyId);

    const slots = this.toSlots(days, duration);
    this.ensureSlotsDoNotOverlap(slots);
    await this.ensureSlotsWithinBusinessHours(slots, companyId);
    await this.ensureProfessionalIsFree(dto.professionalId, slots);

    const classGroup = await this.prisma.classGroup.create({
      data: {
        ...data,
        normalizedName: dto.name ? normalizeForSearch(dto.name) : null,
        companyId,
        days: {
          create: days.map(({ weekDay, startTime }) => ({
            weekDay,
            startTime: parseTimeOfDay(startTime),
          })),
        },
      },
      ...withDetails,
    });

    return this.toResponse(classGroup);
  }

  async findAll(
    {
      page,
      limit,
      name,
      isActive,
      serviceId,
      professionalId,
      from,
      to,
    }: FindClassGroupsQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<ClassGroupResponse>> {
    const where: Prisma.ClassGroupWhereInput = {
      companyId,
      isActive,
      serviceId,
      professionalId,
      normalizedName: name ? { contains: normalizeForSearch(name) } : undefined,
      createdAt: await this.createdAtFilter(from, to, companyId),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.classGroup.findMany({
        where,
        ...withDetails,
        // Da mais recente para a mais antiga; o id desempata para a paginação não repetir registros.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.classGroup.count({ where }),
    ]);

    return {
      items: items.map((classGroup) => this.toResponse(classGroup)),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string, companyId: string): Promise<ClassGroupResponse> {
    return this.toResponse(await this.findInCompany(id, companyId));
  }

  async update(
    id: string,
    dto: UpdateClassGroupDto,
    companyId: string,
  ): Promise<ClassGroupResponse> {
    const current = await this.findInCompany(id, companyId);

    // Reativar confere tudo de novo: serviço, profissional, funcionamento e
    // outras turmas do profissional podem ter mudado enquanto estava inativa.
    if (dto.isActive === true && !current.isActive) {
      await this.ensureCanReactivate(current, companyId);
    }

    const classGroup = await this.prisma.$transaction(async (tx) => {
      if (dto.capacity !== undefined && dto.capacity !== current.capacity) {
        await this.applyCapacityToFutureSessions(
          tx,
          id,
          dto.capacity,
          companyId,
        );
      }

      return tx.classGroup.update({
        where: { id },
        data: {
          ...dto,
          // Mantém a coluna de busca em sincronia sempre que o nome muda.
          ...(dto.name !== undefined && {
            normalizedName: dto.name ? normalizeForSearch(dto.name) : null,
          }),
          updatedAt: new Date(),
        },
        ...withDetails,
      });
    });

    return this.toResponse(classGroup);
  }

  /**
   * A mudança de vagas vale para as sessões futuras da turma (ainda não
   * iniciadas e não canceladas), que são travadas para nenhum encaixe passar no
   * meio. Nenhuma pode ficar com menos vagas do que alunos (409).
   */
  private async applyCapacityToFutureSessions(
    tx: Prisma.TransactionClient,
    classGroupId: string,
    capacity: number,
    companyId: string,
  ): Promise<void> {
    const now = new Date();
    const sessions = await tx.$queryRaw<{ id: string; startAt: Date }[]>`
      SELECT "id", "startAt" FROM "class_sessions"
      WHERE "classGroupId" = ${classGroupId} AND "startAt" > ${now}
        AND "cancelledAt" IS NULL
      ORDER BY "startAt"
      FOR UPDATE`;
    if (sessions.length === 0) {
      return;
    }

    const occupied = await tx.appointment.groupBy({
      by: ["classSessionId"],
      where: {
        classSessionId: { in: sessions.map((session) => session.id) },
        status: { not: AppointmentStatus.CANCELLED },
      },
      _count: { _all: true },
    });
    // A primeira sessão, em ordem de data, com mais alunos do que as novas vagas.
    const countOf = (sessionId: string) =>
      occupied.find((row) => row.classSessionId === sessionId)?._count._all ??
      0;
    const full = sessions.find((session) => countOf(session.id) > capacity);
    if (full) {
      const timeZone = await this.companyService.getTimeZone(companyId);
      throw new ConflictException(
        `A sessão de ${formatZonedDateTime(full.startAt, timeZone)} já tem ${countOf(full.id)} alunos: as vagas não podem ficar abaixo disso`,
      );
    }

    await tx.classSession.updateMany({
      where: { id: { in: sessions.map((session) => session.id) } },
      data: { capacity, updatedAt: now },
    });
  }

  private async findInCompany(
    id: string,
    companyId: string,
  ): Promise<ClassGroupWithDetails> {
    const classGroup = await this.prisma.classGroup.findFirst({
      where: { id, companyId },
      ...withDetails,
    });

    if (!classGroup) {
      throw new NotFoundException("Turma não encontrada");
    }

    return classGroup;
  }

  private async ensureCanReactivate(
    classGroup: ClassGroupWithDetails,
    companyId: string,
  ): Promise<void> {
    const duration = await this.ensureServiceAcceptsClasses(
      classGroup.serviceId,
      companyId,
    );
    await this.ensureProfessional(classGroup.professionalId, companyId);

    const slots = this.toSlots(
      classGroup.days.map((day) => ({
        weekDay: day.weekDay,
        startTime: formatTimeOfDay(day.startTime),
      })),
      duration,
    );
    await this.ensureSlotsWithinBusinessHours(slots, companyId);
    await this.ensureProfessionalIsFree(
      classGroup.professionalId,
      slots,
      classGroup.id,
    );
  }

  // O serviço precisa estar ativo e aceitar turma; devolve a duração, que define o fim de cada horário.
  private async ensureServiceAcceptsClasses(
    serviceId: string,
    companyId: string,
  ): Promise<number> {
    const service = await this.serviceService.findActive(serviceId, companyId);

    if (!service.allowsClasses) {
      throw new BadRequestException(
        "O serviço não aceita atendimento em turma",
      );
    }

    return service.duration;
  }

  private async ensureProfessional(
    professionalId: string,
    companyId: string,
  ): Promise<void> {
    const professional = await this.peopleService.findOne(
      professionalId,
      companyId,
    );

    if (professional.type !== PeopleType.PROFESSIONAL) {
      throw new BadRequestException(
        "professionalId deve ser uma pessoa do tipo PROFESSIONAL",
      );
    }
  }

  private toSlots(days: ClassGroupDayDto[], duration: number): WeeklySlot[] {
    return days.map(({ weekDay, startTime }) => {
      const start = minutesOf(startTime);
      return { weekDay, start, end: start + duration };
    });
  }

  /**
   * Dois horários da mesma turma não podem se sobrepor no mesmo dia da semana
   * (podem se encostar). Ordenados por dia e início, basta comparar vizinhos.
   */
  private ensureSlotsDoNotOverlap(slots: WeeklySlot[]): void {
    const ordered = [...slots].sort(
      (a, b) => a.weekDay.localeCompare(b.weekDay) || a.start - b.start,
    );

    const overlap = ordered.find(
      (slot, index) =>
        index > 0 &&
        slot.weekDay === ordered[index - 1].weekDay &&
        slot.start < ordered[index - 1].end,
    );

    if (overlap) {
      throw new BadRequestException(
        `Há horários sobrepostos na ${WEEK_DAY_LABEL[overlap.weekDay]} na mesma turma`,
      );
    }
  }

  // A turma fixa não tem encaixe: cada horário precisa caber numa janela de atendimento.
  private async ensureSlotsWithinBusinessHours(
    slots: WeeklySlot[],
    companyId: string,
  ): Promise<void> {
    for (const slot of slots) {
      const fits =
        await this.businessHourService.isWeeklySlotWithinBusinessHours(
          companyId,
          slot.weekDay,
          slot.start,
          slot.end,
        );

      if (!fits) {
        throw new BadRequestException(
          `O horário de ${WEEK_DAY_LABEL[slot.weekDay]} às ${formatMinutes(slot.start)} está fora do funcionamento da empresa`,
        );
      }
    }
  }

  /**
   * O profissional não pode ter duas turmas ativas no mesmo horário semanal:
   * os alunos das duas cairiam no mesmo atendimento. `exceptId` ignora a
   * própria turma (na reativação).
   */
  private async ensureProfessionalIsFree(
    professionalId: string,
    slots: WeeklySlot[],
    exceptId?: string,
  ): Promise<void> {
    const others = await this.prisma.classGroup.findMany({
      where: {
        professionalId,
        isActive: true,
        ...(exceptId && { id: { not: exceptId } }),
      },
      select: {
        name: true,
        service: { select: { duration: true } },
        days: { select: { weekDay: true, startTime: true } },
      },
    });

    for (const other of others) {
      const otherSlots = this.toSlots(
        other.days.map((day) => ({
          weekDay: day.weekDay,
          startTime: formatTimeOfDay(day.startTime),
        })),
        other.service.duration,
      );

      const clash = slots.find((slot) =>
        otherSlots.some(
          (taken) =>
            taken.weekDay === slot.weekDay &&
            slot.start < taken.end &&
            taken.start < slot.end,
        ),
      );

      if (clash) {
        throw new ConflictException(
          `O profissional já tem ${other.name ? `a turma "${other.name}"` : "outra turma"} na ${WEEK_DAY_LABEL[clash.weekDay]} às ${formatMinutes(clash.start)}`,
        );
      }
    }
  }

  /**
   * Período de cadastro: dias inteiros no fuso da empresa, do início do dia
   * `from` até o fim do dia `to` (os dois incluídos).
   */
  private async createdAtFilter(
    from: Date | undefined,
    to: Date | undefined,
    companyId: string,
  ): Promise<Prisma.DateTimeFilter | undefined> {
    if (!from && !to) {
      return undefined;
    }

    const timeZone = await this.companyService.getTimeZone(companyId);
    // A data chega como meia-noite UTC do dia informado: só o calendário importa.
    const startOfDay = (date: Date, plusDays = 0) =>
      zonedToUtc(
        {
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
          day: date.getUTCDate() + plusDays,
          hours: 0,
          minutes: 0,
        },
        timeZone,
      );

    return {
      gte: from && startOfDay(from),
      lt: to && startOfDay(to, 1),
    };
  }

  private toResponse(classGroup: ClassGroupWithDetails): ClassGroupResponse {
    const { days, ...rest } = classGroup;
    const { duration } = classGroup.service;

    return {
      ...rest,
      days: days.map((day) => {
        const start = minutesOf(formatTimeOfDay(day.startTime));
        return {
          weekDay: day.weekDay,
          startTime: formatMinutes(start),
          endTime: formatMinutes((start + duration) % (24 * 60)),
        };
      }),
    };
  }
}
