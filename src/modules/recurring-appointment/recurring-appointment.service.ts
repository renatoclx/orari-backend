import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PeopleType, WeekDay } from "../../../generated/prisma/enums";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import {
  formatTimeOfDay,
  parseTimeOfDay,
  WEEK_DAY_BY_INDEX,
} from "../../common/time/time-of-day";
import { toZonedParts, zonedToUtc } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import {
  AppointmentOccurrence,
  AppointmentService,
} from "../appointment/appointment.service";
import { CompanyService } from "../company/company.service";
import { PeopleService } from "../people/people.service";
import { ServiceService } from "../service/service.service";
import { CreateRecurringAppointmentDto } from "./dto/create-recurring-appointment.dto";
import { FindRecurringAppointmentsQueryDto } from "./dto/find-recurring-appointments-query.dto";
import { RecurringDayDto } from "./dto/recurring-day.dto";
import { UpdateRecurringAppointmentDto } from "./dto/update-recurring-appointment.dto";

// Os dias são devolvidos com horários em "HH:MM", como entraram.
export interface RecurringAppointmentResponse {
  id: string;
  companyId: string;
  clientId: string;
  professionalId: string;
  serviceId: string;
  startDate: Date;
  endDate: Date | null;
  note: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date | null;
  days: RecurringDayDto[];
}

/**
 * Até onde gerar agendamentos de uma vez. Recorrências sem data final são
 * "abertas": o horizonte não avança sozinho — quando ele está acabando, uma
 * notificação avisa a empresa, que estende manualmente (ver NotificationService).
 */
export const GENERATION_HORIZON_DAYS = 90;

// Com menos dias gerados do que isto, a recorrência precisa ser estendida.
export const HORIZON_WARNING_DAYS = 30;

const withDays = {
  include: { days: { orderBy: { startTime: "asc" } } },
} satisfies Prisma.RecurringAppointmentDefaultArgs;

type RecurringAppointmentWithDays = Prisma.RecurringAppointmentGetPayload<
  typeof withDays
>;

/**
 * Agendamentos recorrentes pertencem à empresa do usuário autenticado; os de
 * outras empresas se comportam como inexistentes (404).
 *
 * Não existe exclusão (ver domain.md): a recorrência é desativada por isActive.
 * Os dias fazem parte da recorrência e são substituídos em bloco.
 */
@Injectable()
export class RecurringAppointmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly peopleService: PeopleService,
    private readonly serviceService: ServiceService,
    private readonly appointmentService: AppointmentService,
    private readonly companyService: CompanyService,
  ) {}

  async create(
    dto: CreateRecurringAppointmentDto,
    companyId: string,
  ): Promise<RecurringAppointmentResponse> {
    const { days, ...data } = dto;

    await this.ensureParticipants(dto.clientId, dto.professionalId, companyId);
    const service = await this.serviceService.findActive(
      dto.serviceId,
      companyId,
    );
    this.ensurePeriodIsValid(dto.startDate, dto.endDate);
    this.ensureDaysAreValid(days, service.duration);

    const timeZone = await this.companyService.getTimeZone(companyId);

    // Recorrência e agendamentos nascem juntos: se algum horário conflitar, nada
    // é gravado.
    const created = await this.prisma.$transaction(async (tx) => {
      const recurring = await tx.recurringAppointment.create({
        data: { ...data, companyId, days: { create: this.toDayRows(days) } },
        ...withDays,
      });

      if (recurring.isActive) {
        await this.appointmentService.createFromRecurrence(
          tx,
          {
            companyId,
            recurringAppointmentId: recurring.id,
            clientId: recurring.clientId,
            professionalId: recurring.professionalId,
            serviceId: recurring.serviceId,
          },
          this.buildOccurrences(
            days,
            recurring.startDate,
            recurring.endDate,
            service.duration,
            timeZone,
            new Date(),
          ),
          recurring.note,
        );
      }

      return recurring;
    });

    return this.toResponse(created);
  }

  async findAll(
    {
      page,
      limit,
      professionalId,
      clientId,
      isActive,
    }: FindRecurringAppointmentsQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<RecurringAppointmentResponse>> {
    const where: Prisma.RecurringAppointmentWhereInput = {
      companyId,
      professionalId,
      clientId,
      isActive,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.recurringAppointment.findMany({
        where,
        ...withDays,
        orderBy: { startDate: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.recurringAppointment.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toResponse(item)),
      total,
      page,
      limit,
    };
  }

  async findOne(
    id: string,
    companyId: string,
  ): Promise<RecurringAppointmentResponse> {
    const recurring = await this.prisma.recurringAppointment.findFirst({
      where: { id, companyId },
      ...withDays,
    });

    if (!recurring) {
      throw new NotFoundException("Agendamento recorrente não encontrado");
    }

    return this.toResponse(recurring);
  }

  async update(
    id: string,
    dto: UpdateRecurringAppointmentDto,
    companyId: string,
  ): Promise<RecurringAppointmentResponse> {
    const current = await this.findOne(id, companyId);
    const { days, ...data } = dto;

    if (dto.clientId || dto.professionalId) {
      await this.ensureParticipants(
        dto.clientId ?? current.clientId,
        dto.professionalId ?? current.professionalId,
        companyId,
      );
    }

    const service = await this.serviceService.findActive(
      dto.serviceId ?? current.serviceId,
      companyId,
    );

    this.ensurePeriodIsValid(
      dto.startDate ?? current.startDate,
      dto.endDate === undefined ? current.endDate : dto.endDate,
    );

    if (days) {
      this.ensureDaysAreValid(days, service.duration);
    }

    const timeZone = await this.companyService.getTimeZone(companyId);

    // Só a observação não afeta a agenda; qualquer outra mudança exige regerar.
    const affectsSchedule = Object.keys(data).some((field) => field !== "note");

    const updated = await this.prisma.$transaction(async (tx) => {
      // Os dias são substituídos em bloco: apagar e recriar na mesma transação
      // evita que a recorrência fique sem dias caso algo falhe no meio.
      const recurring = await tx.recurringAppointment.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
          ...(days && {
            days: { deleteMany: {}, create: this.toDayRows(days) },
          }),
        },
        ...withDays,
      });

      if (!days && !affectsSchedule) {
        return recurring;
      }

      // Regerar preserva o histórico: só os futuros ainda em SCHEDULED saem.
      await this.appointmentService.cancelFutureFromRecurrence(
        tx,
        id,
        new Date(),
      );

      if (recurring.isActive) {
        await this.appointmentService.createFromRecurrence(
          tx,
          {
            companyId,
            recurringAppointmentId: recurring.id,
            clientId: recurring.clientId,
            professionalId: recurring.professionalId,
            serviceId: recurring.serviceId,
          },
          this.buildOccurrences(
            recurring.days.map((day) => ({
              weekDay: day.weekDay,
              startTime: formatTimeOfDay(day.startTime),
              endTime: formatTimeOfDay(day.endTime),
            })),
            recurring.startDate,
            recurring.endDate,
            service.duration,
            timeZone,
            new Date(),
          ),
          recurring.note,
        );
      }

      return recurring;
    });

    return this.toResponse(updated);
  }

  private async ensureParticipants(
    clientId: string,
    professionalId: string,
    companyId: string,
  ) {
    const client = await this.peopleService.findOne(clientId, companyId);
    if (client.type !== PeopleType.CLIENT) {
      throw new BadRequestException(
        "clientId deve ser uma pessoa do tipo CLIENT",
      );
    }

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

  private ensurePeriodIsValid(startDate: Date, endDate?: Date | null) {
    if (endDate && endDate < startDate) {
      throw new BadRequestException("endDate deve ser posterior a startDate");
    }
  }

  /**
   * Cada dia precisa terminar depois de começar, e dois dias da mesma recorrência
   * não podem se sobrepor no mesmo dia da semana (os limites podem se encostar).
   */
  private ensureDaysAreValid(days: RecurringDayDto[], serviceDuration: number) {
    for (const day of days) {
      if (day.endTime <= day.startTime) {
        throw new BadRequestException(
          "endTime deve ser posterior a startTime em cada dia",
        );
      }

      // O horário reservado precisa comportar o atendimento, já que o fim de
      // cada agendamento gerado vem da duração do serviço.
      if (this.minutesBetween(day.startTime, day.endTime) < serviceDuration) {
        throw new BadRequestException(
          `Cada dia deve reservar ao menos ${serviceDuration} minutos, a duração do serviço`,
        );
      }
    }

    const byWeekDay = new Map<WeekDay, RecurringDayDto[]>();
    for (const day of days) {
      byWeekDay.set(day.weekDay, [...(byWeekDay.get(day.weekDay) ?? []), day]);
    }

    for (const [weekDay, sameDay] of byWeekDay) {
      const ordered = [...sameDay].sort((a, b) =>
        a.startTime.localeCompare(b.startTime),
      );

      const overlaps = ordered.some(
        (day, index) => index > 0 && day.startTime < ordered[index - 1].endTime,
      );

      if (overlaps) {
        throw new BadRequestException(
          `Há horários sobrepostos em ${weekDay} na mesma recorrência`,
        );
      }
    }
  }

  /**
   * Monta os horários que a recorrência ocupa.
   *
   * Gera do maior valor entre o início da recorrência e hoje (não se cria
   * histórico) até a data final ou, quando não houver, o horizonte padrão. Cada
   * ocorrência começa no horário reservado do dia e termina conforme a duração
   * do serviço.
   */
  private buildOccurrences(
    days: RecurringDayDto[],
    startDate: Date,
    endDate: Date | null,
    serviceDuration: number,
    timeZone: string,
    from: Date,
  ): AppointmentOccurrence[] {
    const now = new Date();

    /*
     * O calendário percorrido é o da empresa: "toda terça às 14h" é terça no
     * relógio dela, e cada horário vira um instante UTC no fim.
     *
     * startDate e endDate são datas puras (coluna `date`), então entram pelo
     * calendário, sem conversão de fuso — convertê-las deslocaria o dia (em
     * UTC-3, "2026-12-15" viraria 14/12 às 21h e perderia o último dia).
     * Já `from` e o horizonte são instantes, e por isso são lidos no fuso.
     */
    const cursor =
      startDate > from
        ? this.toDateParts(startDate)
        : toZonedParts(from, timeZone);

    const horizon = this.addDays(cursor, GENERATION_HORIZON_DAYS);
    const endDateParts = endDate ? this.toDateParts(endDate) : null;
    const limit =
      endDateParts && this.isBeforeOrSameDay(endDateParts, horizon)
        ? endDateParts
        : horizon;

    const occurrences: AppointmentOccurrence[] = [];

    while (this.isBeforeOrSameDay(cursor, limit)) {
      const weekDay = WEEK_DAY_BY_INDEX[this.weekDayIndex(cursor)];

      for (const day of days.filter((item) => item.weekDay === weekDay)) {
        const [hours, minutes] = day.startTime.split(":").map(Number);
        const startAt = zonedToUtc({ ...cursor, hours, minutes }, timeZone);

        // Uma ocorrência que já passou não é criada.
        if (startAt > now) {
          occurrences.push({
            startAt,
            endAt: new Date(startAt.getTime() + serviceDuration * 60_000),
          });
        }
      }

      this.advanceOneDay(cursor);
    }

    return occurrences;
  }

  // Data pura (coluna `date`): o dia é o que está gravado, sem conversão de fuso.
  private toDateParts(value: Date) {
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
      hours: 0,
      minutes: 0,
    };
  }

  private addDays(
    { year, month, day }: { year: number; month: number; day: number },
    days: number,
  ) {
    const shifted = new Date(Date.UTC(year, month - 1, day + days));

    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hours: 0,
      minutes: 0,
    };
  }

  private weekDayIndex({
    year,
    month,
    day,
  }: {
    year: number;
    month: number;
    day: number;
  }): number {
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  }

  private isBeforeOrSameDay(
    cursor: { year: number; month: number; day: number },
    limit: { year: number; month: number; day: number },
  ): boolean {
    return (
      Date.UTC(cursor.year, cursor.month - 1, cursor.day) <=
      Date.UTC(limit.year, limit.month - 1, limit.day)
    );
  }

  private advanceOneDay(cursor: {
    year: number;
    month: number;
    day: number;
  }): void {
    const next = new Date(
      Date.UTC(cursor.year, cursor.month - 1, cursor.day + 1),
    );
    cursor.year = next.getUTCFullYear();
    cursor.month = next.getUTCMonth() + 1;
    cursor.day = next.getUTCDate();
  }

  /**
   * Até quando a recorrência já tem agendamentos gerados, e se ela precisa ser
   * estendida: continua ativa, ainda tem período pela frente e o que foi gerado
   * termina dentro da janela de aviso.
   */
  async findNeedingExtension(companyId: string): Promise<
    {
      id: string;
      generatedUntil: Date | null;
    }[]
  > {
    const recurrences = await this.prisma.recurringAppointment.findMany({
      where: {
        companyId,
        isActive: true,
        OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
      },
      select: {
        id: true,
        endDate: true,
        appointments: {
          where: { status: { not: "CANCELLED" } },
          orderBy: { startAt: "desc" },
          take: 1,
          select: { startAt: true },
        },
      },
    });

    const warningLimit = new Date();
    warningLimit.setUTCDate(warningLimit.getUTCDate() + HORIZON_WARNING_DAYS);

    return recurrences
      .map((recurrence) => ({
        id: recurrence.id,
        endDate: recurrence.endDate,
        generatedUntil: recurrence.appointments[0]?.startAt ?? null,
      }))
      .filter(({ endDate, generatedUntil }) => {
        // Já gerou tudo até o fim previsto: não há o que estender.
        if (endDate && generatedUntil && generatedUntil >= endDate) {
          return false;
        }

        return !generatedUntil || generatedUntil < warningLimit;
      })
      .map(({ id, generatedUntil }) => ({ id, generatedUntil }));
  }

  /**
   * Estende manualmente o horizonte: gera mais um bloco de agendamentos a partir
   * do último já gerado. É a ação que resolve a notificação de horizonte.
   */
  async extend(id: string, companyId: string): Promise<{ created: number }> {
    const current = await this.findOne(id, companyId);

    if (!current.isActive) {
      throw new BadRequestException(
        "Não é possível estender uma recorrência inativa",
      );
    }

    const service = await this.serviceService.findActive(
      current.serviceId,
      companyId,
    );
    const timeZone = await this.companyService.getTimeZone(companyId);

    const last = await this.prisma.appointment.aggregate({
      where: { recurringAppointmentId: id, status: { not: "CANCELLED" } },
      _max: { startAt: true },
    });

    // Continua do dia seguinte ao último gerado; sem nada gerado, começa de hoje.
    const from = last._max.startAt
      ? new Date(last._max.startAt.getTime() + 86_400_000)
      : new Date();

    const occurrences = this.buildOccurrences(
      current.days,
      current.startDate,
      current.endDate,
      service.duration,
      timeZone,
      from,
    );

    if (occurrences.length === 0) {
      throw new BadRequestException(
        "Não há novos horários a gerar para esta recorrência",
      );
    }

    const created = await this.prisma.$transaction((tx) =>
      this.appointmentService.createFromRecurrence(
        tx,
        {
          companyId,
          recurringAppointmentId: id,
          clientId: current.clientId,
          professionalId: current.professionalId,
          serviceId: current.serviceId,
        },
        occurrences,
        current.note,
      ),
    );

    return { created };
  }

  private minutesBetween(startTime: string, endTime: string): number {
    const toMinutes = (time: string) => {
      const [hours, minutes] = time.split(":").map(Number);
      return hours * 60 + minutes;
    };

    return toMinutes(endTime) - toMinutes(startTime);
  }

  private toDayRows(days: RecurringDayDto[]) {
    return days.map(({ weekDay, startTime, endTime }) => ({
      weekDay,
      startTime: parseTimeOfDay(startTime),
      endTime: parseTimeOfDay(endTime),
    }));
  }

  private toResponse(
    recurring: RecurringAppointmentWithDays,
  ): RecurringAppointmentResponse {
    const { days, ...rest } = recurring;

    return {
      ...rest,
      days: days.map((day) => ({
        weekDay: day.weekDay,
        startTime: formatTimeOfDay(day.startTime),
        endTime: formatTimeOfDay(day.endTime),
      })),
    };
  }
}
