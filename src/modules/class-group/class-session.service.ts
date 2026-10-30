import { randomUUID } from "node:crypto";
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
import {
  formatTimeOfDay,
  WEEK_DAY_BY_INDEX,
} from "../../common/time/time-of-day";
import {
  minutesOfZonedDay,
  toZonedParts,
  weekDayIndexOf,
  zonedToUtc,
} from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import {
  AppointmentService,
  AppointmentWithRelations,
} from "../appointment/appointment.service";
import { BusinessHourService } from "../business-hour/business-hour.service";
import { CompanyService } from "../company/company.service";
import { PaymentService } from "../payment/payment.service";
import { PeopleService } from "../people/people.service";
import { ServiceService } from "../service/service.service";
import {
  formatZonedDateTime,
  minutesOf,
  WEEK_DAY_LABEL,
} from "./class-group-schedule";
import { CancelClassSessionDto } from "./dto/cancel-class-session.dto";
import {
  CreateClassSessionDto,
  UpdateClassSessionDto,
} from "./dto/create-class-session.dto";
import {
  EnrollClassGroupParticipantDto,
  EnrollClassSessionParticipantDto,
} from "./dto/enroll-class-participant.dto";
import {
  CLASS_SESSIONS_RANGE_MAX_DAYS,
  FindClassSessionsQueryDto,
} from "./dto/find-class-sessions-query.dto";

const DAY_MS = 86_400_000;

// Ocupam vaga todos os agendamentos da sessão, menos os cancelados (a falta ocupa).
const OCCUPYING = { not: AppointmentStatus.CANCELLED } as const;

// Só um agendamento que ainda não aconteceu vira turma.
const CONVERTIBLE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
];

const serviceSummary = {
  select: { id: true, name: true, color: true, duration: true },
} as const;
const professionalSummary = {
  select: { id: true, name: true, photoUrl: true },
} as const;

// A sessão como a tela a mostra: vagas e alunos.
const withParticipants = {
  include: {
    classGroup: { select: { id: true, name: true } },
    service: serviceSummary,
    professional: professionalSummary,
    appointments: {
      select: {
        id: true,
        status: true,
        // Preenchido quando a clínica cancelou a aula (sessão cancelada ou saída da turma).
        cancelReason: true,
        client: { select: { id: true, name: true, photoUrl: true } },
      },
      orderBy: { client: { name: "asc" } },
    },
  },
} satisfies Prisma.ClassSessionDefaultArgs;

type SessionWithParticipants = Prisma.ClassSessionGetPayload<
  typeof withParticipants
>;

export type ClassSessionResponse = SessionWithParticipants & {
  // Alunos que ocupam vaga (não cancelados) e vagas livres.
  occupied: number;
  available: number;
};

/**
 * Item da agenda por sessão (GET /class-sessions). O horário de turma fixa que
 * ainda não tem sessão vem com `id: null`, sem alunos: a sessão só é criada no
 * primeiro encaixe, mas a agenda já mostra o horário.
 */
export interface ClassSessionAgendaItem {
  id: string | null;
  classGroup: { id: string; name: string | null } | null;
  service: SessionWithParticipants["service"];
  professional: SessionWithParticipants["professional"];
  startAt: Date;
  endAt: Date;
  capacity: number;
  occupied: number;
  available: number;
  overBooking: boolean;
  cancelledAt: Date | null;
  cancellationNote: string | null;
  appointments: SessionWithParticipants["appointments"];
}

// A linha da sessão como a trava (SELECT ... FOR UPDATE) a devolve.
interface LockedSession {
  id: string;
  capacity: number;
  cancelledAt: Date | null;
}

// O que todo encaixe precisa saber da sessão, já travada.
interface SessionForEnrollment {
  id: string;
  companyId: string;
  serviceId: string;
  professionalId: string;
  startAt: Date;
  endAt: Date;
  overBooking: boolean;
}

// A turma fixa como a sessão de um horário dela é criada.
interface ClassGroupForSession {
  id: string;
  companyId: string;
  serviceId: string;
  professionalId: string;
  capacity: number;
}

// Horário de uma turma fixa já validado, pronto para reservar a vaga (ver resolveClassGroupSlot).
export interface ClassGroupSlot {
  classGroup: ClassGroupForSession;
  startAt: Date;
  endAt: Date;
}

/**
 * Sessões de turma (ver docs/turmas.md): cada aluno tem o próprio agendamento,
 * ligado à sessão. Só o ADMIN encaixa alunos e cria sessões (restrito nos
 * controllers).
 *
 * A vaga é conferida dentro da transação, com a linha da sessão travada: duas
 * inclusões ao mesmo tempo na última vaga não passam juntas. A regra de
 * conflito de agenda fica no AppointmentService (createInClassSession).
 */
@Injectable()
export class ClassSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentService: AppointmentService,
    private readonly serviceService: ServiceService,
    private readonly peopleService: PeopleService,
    private readonly businessHourService: BusinessHourService,
    private readonly companyService: CompanyService,
    private readonly paymentService: PaymentService,
  ) {}

  /**
   * Encaixe avulso numa turma fixa: o horário escolhe a sessão, criada no
   * primeiro encaixe daquele dia.
   */
  async enrollInClassGroup(
    classGroupId: string,
    dto: EnrollClassGroupParticipantDto,
    companyId: string,
  ): Promise<AppointmentWithRelations> {
    const classGroup = await this.prisma.classGroup.findFirst({
      where: { id: classGroupId, companyId },
      include: {
        days: { select: { weekDay: true, startTime: true } },
      },
    });
    if (!classGroup) {
      throw new NotFoundException("Turma não encontrada");
    }
    if (!classGroup.isActive) {
      throw new ConflictException("A turma está inativa");
    }

    this.ensureHasNotStarted(dto.startAt);
    const duration = await this.ensureServiceAcceptsClasses(
      classGroup.serviceId,
      companyId,
    );
    await this.ensureClient(dto.clientId, companyId);

    const timeZone = await this.companyService.getTimeZone(companyId);
    this.ensureMatchesClassGroupDay(dto.startAt, classGroup.days, timeZone);

    const endAt = new Date(dto.startAt.getTime() + duration * 60_000);
    // A turma fixa não tem encaixe: a sessão precisa caber numa janela.
    await this.businessHourService.ensureWithinBusinessHours(
      companyId,
      dto.startAt,
      endAt,
    );

    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockClassGroupSession(
        tx,
        classGroup,
        dto.startAt,
        endAt,
      );

      return this.enrollLocked(tx, locked, dto, {
        id: locked.id,
        companyId,
        serviceId: classGroup.serviceId,
        professionalId: classGroup.professionalId,
        startAt: dto.startAt,
        endAt,
        overBooking: false,
      });
    });
  }

  /**
   * Antes de gravar uma recorrência (avulsa ou de plano) encaixada na turma:
   * a turma é da empresa e está ativa, serviço e profissional são os dela, o
   * serviço continua aceitando turma e cada dia é um dos horários da turma.
   */
  async ensureRecurrenceFitsClassGroup(
    classGroupId: string,
    {
      serviceId,
      professionalId,
      days,
    }: {
      serviceId: string;
      professionalId: string;
      days: { weekDay: WeekDay; startTime: string }[];
    },
    companyId: string,
  ): Promise<void> {
    const classGroup = await this.prisma.classGroup.findFirst({
      where: { id: classGroupId, companyId },
      include: { days: { select: { weekDay: true, startTime: true } } },
    });
    if (!classGroup) {
      throw new NotFoundException("Turma não encontrada");
    }
    if (!classGroup.isActive) {
      throw new ConflictException("A turma está inativa");
    }
    if (
      classGroup.serviceId !== serviceId ||
      classGroup.professionalId !== professionalId
    ) {
      throw new BadRequestException(
        "serviceId e professionalId devem ser os da turma",
      );
    }
    await this.ensureServiceAcceptsClasses(serviceId, companyId);

    const outside = days.find(
      (day) =>
        !classGroup.days.some(
          (slot) =>
            slot.weekDay === day.weekDay &&
            formatTimeOfDay(slot.startTime) === day.startTime,
        ),
    );
    if (outside) {
      throw new BadRequestException(
        `A turma não tem horário na ${WEEK_DAY_LABEL[outside.weekDay]} às ${outside.startTime}`,
      );
    }
  }

  /**
   * Reserva as sessões da turma para as ocorrências de uma recorrência, dentro
   * da transação de quem chama: cria a sessão de cada horário se faltar, trava
   * e confere a vaga. Devolve as ocorrências com a sessão de cada uma, para o
   * AppointmentService gravar os agendamentos já ligados a ela. As travas
   * seguram as vagas até o fim da transação.
   */
  async reserveForOccurrences(
    tx: Prisma.TransactionClient,
    classGroupId: string,
    occurrences: { startAt: Date; endAt: Date }[],
    timeZone: string,
  ): Promise<{ startAt: Date; endAt: Date; classSessionId: string }[]> {
    const classGroup = await tx.classGroup.findUniqueOrThrow({
      where: { id: classGroupId },
    });

    const reserved: { startAt: Date; endAt: Date; classSessionId: string }[] =
      [];
    for (const occurrence of occurrences) {
      const locked = await this.lockClassGroupSession(
        tx,
        classGroup,
        occurrence.startAt,
        occurrence.endAt,
      );
      const when = formatZonedDateTime(occurrence.startAt, timeZone);

      if (locked.cancelledAt) {
        throw new ConflictException(
          `A sessão da turma em ${when} foi cancelada`,
        );
      }
      const occupied = await tx.appointment.count({
        where: { classSessionId: locked.id, status: OCCUPYING },
      });
      if (occupied >= locked.capacity) {
        throw new ConflictException(`Sem vaga na turma em ${when}`);
      }

      reserved.push({ ...occurrence, classSessionId: locked.id });
    }

    return reserved;
  }

  /** Encaixe numa sessão que já existe, de turma fixa ou avulsa. */
  async enroll(
    id: string,
    dto: EnrollClassSessionParticipantDto,
    companyId: string,
  ): Promise<AppointmentWithRelations> {
    const session = await this.findInCompany(id, companyId);
    if (session.classGroupId) {
      await this.ensureClassGroupIsActive(session.classGroupId);
    }
    this.ensureHasNotStarted(session.startAt);
    await this.ensureServiceAcceptsClasses(session.serviceId, companyId);
    await this.ensureClient(dto.clientId, companyId);

    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lock(tx, id);
      return this.enrollLocked(tx, locked, dto, session);
    });
  }

  /**
   * Agendamento que vira turma: cria a sessão avulsa com o horário, o serviço,
   * o profissional e o encaixe dele, e liga o agendamento a ela.
   */
  async create(
    { appointmentId, capacity }: CreateClassSessionDto,
    companyId: string,
  ): Promise<ClassSessionResponse> {
    const appointment = await this.appointmentService.findOne(
      appointmentId,
      companyId,
    );
    if (appointment.classSessionId) {
      throw new ConflictException("O agendamento já pertence a uma turma");
    }
    if (!CONVERTIBLE_STATUSES.includes(appointment.status)) {
      throw new BadRequestException(
        `Agendamento com status ${appointment.status} não pode virar turma`,
      );
    }
    this.ensureHasNotStarted(appointment.startAt);
    await this.ensureServiceAcceptsClasses(appointment.serviceId, companyId);

    const sessionId = await this.prisma.$transaction(async (tx) => {
      const session = await tx.classSession.create({
        data: {
          companyId,
          serviceId: appointment.serviceId,
          professionalId: appointment.professionalId,
          startAt: appointment.startAt,
          endAt: appointment.endAt,
          capacity,
          overBooking: appointment.overBooking,
        },
        select: { id: true },
      });
      await this.appointmentService.attachToClassSession(
        tx,
        appointment.id,
        session.id,
      );

      return session.id;
    });

    return this.findOne(sessionId, companyId);
  }

  async findOne(id: string, companyId: string): Promise<ClassSessionResponse> {
    const session = await this.prisma.classSession.findFirst({
      where: { id, companyId },
      ...withParticipants,
    });
    if (!session) {
      throw new NotFoundException("Sessão da turma não encontrada");
    }

    return { ...session, ...this.seatsOf(session) };
  }

  /**
   * Agenda por sessão, no período (até 31 dias, sem paginação): as sessões que
   * existem, inclusive as canceladas, e os horários futuros das turmas fixas
   * ativas que ainda não têm sessão. O horário vazio fica de fora quando o
   * profissional tem outro compromisso que o sobrepõe (o encaixe ali seria
   * recusado). Ordem: início e, no mesmo horário, nome do profissional.
   */
  async findAll(
    query: FindClassSessionsQueryDto,
    companyId: string,
  ): Promise<ClassSessionAgendaItem[]> {
    const { from, to, professionalId, serviceId, classGroupId } = query;
    this.ensureRangeIsValid(from, to);

    const sessions = await this.prisma.classSession.findMany({
      where: {
        companyId,
        startAt: { gte: from, lt: to },
        professionalId,
        serviceId,
        classGroupId,
      },
      ...withParticipants,
    });
    const empty = await this.findEmptySlots(query, companyId);

    return [
      ...sessions.map((session) => this.toAgendaItem(session)),
      ...empty,
    ].sort(
      (a, b) =>
        a.startAt.getTime() - b.startAt.getTime() ||
        a.professional.name.localeCompare(b.professional.name, "pt-BR"),
    );
  }

  /** Vagas de uma sessão: só antes do início e nunca abaixo dos alunos que ela já tem. */
  async update(
    id: string,
    { capacity }: UpdateClassSessionDto,
    companyId: string,
  ): Promise<ClassSessionResponse> {
    const session = await this.findInCompany(id, companyId);
    this.ensureHasNotStarted(session.startAt);

    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lock(tx, id);
      this.ensureNotCancelled(locked);

      const occupied = await tx.appointment.count({
        where: { classSessionId: id, status: OCCUPYING },
      });
      if (occupied > capacity) {
        throw new ConflictException(
          `A sessão já tem ${occupied} alunos: as vagas não podem ficar abaixo disso`,
        );
      }

      await tx.classSession.update({
        where: { id },
        data: { capacity, updatedAt: new Date() },
      });
    });

    return this.findOne(id, companyId);
  }

  /**
   * Cancela a sessão inteira, antes de ela começar: os agendamentos dos alunos
   * que ainda não aconteceram são cancelados (com o motivo, que permite repor
   * as sessões de plano) e os pagamentos pendentes deles também, na mesma
   * transação. O pagamento já recebido não muda. A sessão cancelada não recebe
   * mais alunos.
   */
  async cancel(
    id: string,
    { note }: CancelClassSessionDto,
    companyId: string,
  ): Promise<ClassSessionResponse> {
    const session = await this.findInCompany(id, companyId);
    this.ensureHasNotStarted(
      session.startAt,
      "A sessão já começou: não pode ser cancelada",
    );

    await this.prisma.$transaction(async (tx) => {
      // A trava faz o cancelamento esperar um encaixe em andamento (e vice-versa).
      const locked = await this.lock(tx, id);
      if (locked.cancelledAt) {
        throw new ConflictException("A sessão da turma já foi cancelada");
      }

      const now = new Date();
      await tx.classSession.update({
        where: { id },
        data: {
          cancelledAt: now,
          cancellationNote: note ?? null,
          updatedAt: now,
        },
      });
      // Agendamentos antes dos pagamentos: o cancelamento dos pagamentos
      // procura os agendamentos que acabaram de ser cancelados.
      await this.appointmentService.cancelForClassSession(tx, id);
      await this.paymentService.cancelPendingForClassSession(tx, id);
    });

    return this.findOne(id, companyId);
  }

  /**
   * Antes da reposição (ou do remanejamento) de uma aula numa turma fixa: a
   * turma é da empresa, está ativa e é do mesmo serviço da aula, o serviço
   * continua aceitando turma, e o início é um horário dela, no futuro e dentro
   * do funcionamento. O profissional pode ser outro: a aula passa a ser com o
   * da turma. A vaga é conferida depois, na transação (reserveSeat).
   */
  async resolveClassGroupSlot(
    classGroupId: string,
    { serviceId, startAt }: { serviceId: string; startAt: Date },
    companyId: string,
    timeZone: string,
  ): Promise<ClassGroupSlot> {
    const classGroup = await this.prisma.classGroup.findFirst({
      where: { id: classGroupId, companyId },
      include: { days: { select: { weekDay: true, startTime: true } } },
    });
    if (!classGroup) {
      throw new NotFoundException("Turma não encontrada");
    }
    if (!classGroup.isActive) {
      throw new ConflictException("A turma está inativa");
    }
    if (classGroup.serviceId !== serviceId) {
      throw new BadRequestException(
        "A turma precisa ser do mesmo serviço da aula",
      );
    }

    this.ensureHasNotStarted(startAt);
    const duration = await this.ensureServiceAcceptsClasses(
      serviceId,
      companyId,
    );
    this.ensureMatchesClassGroupDay(startAt, classGroup.days, timeZone);

    const endAt = new Date(startAt.getTime() + duration * 60_000);
    await this.businessHourService.ensureWithinBusinessHours(
      companyId,
      startAt,
      endAt,
    );

    return { classGroup, startAt, endAt };
  }

  /**
   * Reserva a vaga de um cliente na sessão do horário da turma, dentro da
   * transação de quem chama: cria a sessão se faltar, trava, e confere se não
   * foi cancelada, se tem vaga e se o cliente já não está nela. A trava segura a
   * vaga até o fim da transação. Devolve a sessão, para o agendamento ir para ela.
   */
  async reserveSeat(
    tx: Prisma.TransactionClient,
    { classGroup, startAt, endAt }: ClassGroupSlot,
    clientId: string,
  ): Promise<{ id: string; professionalId: string }> {
    const locked = await this.lockClassGroupSession(
      tx,
      classGroup,
      startAt,
      endAt,
    );
    await this.ensureHasSeatFor(tx, locked, clientId);

    return { id: locked.id, professionalId: classGroup.professionalId };
  }

  // Período da agenda: o fim depois do início, e no máximo 31 dias.
  private ensureRangeIsValid(from: Date, to: Date): void {
    if (to <= from) {
      throw new BadRequestException("to deve ser posterior a from");
    }
    if (
      to.getTime() - from.getTime() >
      CLASS_SESSIONS_RANGE_MAX_DAYS * DAY_MS
    ) {
      throw new BadRequestException(
        `O período deve ter no máximo ${CLASS_SESSIONS_RANGE_MAX_DAYS} dias`,
      );
    }
  }

  /**
   * Horários futuros das turmas fixas ativas, no período, que ainda não têm
   * sessão e em que o profissional está livre (sem agendamento não cancelado
   * que os sobreponha, de turma ou individual).
   */
  private async findEmptySlots(
    {
      from,
      to,
      professionalId,
      serviceId,
      classGroupId,
    }: FindClassSessionsQueryDto,
    companyId: string,
  ): Promise<ClassSessionAgendaItem[]> {
    // Horário vazio só no futuro: não se encaixa aluno numa aula que já começou.
    const now = new Date();
    const start = from > now ? from : now;
    if (start >= to) {
      return [];
    }

    const groups = await this.prisma.classGroup.findMany({
      where: {
        companyId,
        isActive: true,
        id: classGroupId,
        serviceId,
        professionalId,
      },
      include: {
        days: { select: { weekDay: true, startTime: true } },
        service: serviceSummary,
        professional: professionalSummary,
      },
    });
    if (groups.length === 0) {
      return [];
    }

    const timeZone = await this.companyService.getTimeZone(companyId);
    const slots = groups.flatMap((group) =>
      this.startsOf(group.days, start, to, timeZone).map((startAt) => ({
        group,
        startAt,
        endAt: new Date(startAt.getTime() + group.service.duration * 60_000),
      })),
    );
    if (slots.length === 0) {
      return [];
    }

    const lastEnd = new Date(
      Math.max(...slots.map((slot) => slot.endAt.getTime())),
    );
    const [taken, busy] = await Promise.all([
      // Qualquer sessão do horário, inclusive a cancelada, já aparece pela própria sessão.
      this.prisma.classSession.findMany({
        where: {
          classGroupId: { in: groups.map((group) => group.id) },
          startAt: { gte: start, lt: to },
        },
        select: { classGroupId: true, startAt: true },
      }),
      this.prisma.appointment.findMany({
        where: {
          companyId,
          professionalId: {
            in: [...new Set(groups.map((group) => group.professionalId))],
          },
          status: OCCUPYING,
          startAt: { lt: lastEnd },
          endAt: { gt: start },
        },
        select: { professionalId: true, startAt: true, endAt: true },
      }),
    ]);

    return slots
      .filter(
        ({ group, startAt, endAt }) =>
          !taken.some(
            (session) =>
              session.classGroupId === group.id &&
              session.startAt.getTime() === startAt.getTime(),
          ) &&
          !busy.some(
            (appointment) =>
              appointment.professionalId === group.professionalId &&
              appointment.startAt < endAt &&
              appointment.endAt > startAt,
          ),
      )
      .map(({ group, startAt, endAt }) => ({
        id: null,
        classGroup: { id: group.id, name: group.name },
        service: group.service,
        professional: group.professional,
        startAt,
        endAt,
        capacity: group.capacity,
        occupied: 0,
        available: group.capacity,
        overBooking: false,
        cancelledAt: null,
        cancellationNote: null,
        appointments: [],
      }));
  }

  /**
   * Inícios dos horários da turma entre `start` (incluído) e `to` (excluído),
   * percorrendo o calendário da empresa: "segunda às 08:00" é segunda no
   * relógio dela, convertida para UTC no fim.
   */
  private startsOf(
    days: { weekDay: WeekDay; startTime: Date }[],
    start: Date,
    to: Date,
    timeZone: string,
  ): Date[] {
    const first = toZonedParts(start, timeZone);
    const last = toZonedParts(to, timeZone);
    const starts: Date[] = [];

    // Date.UTC só como calculadora de calendário (vira o mês, o ano bissexto etc.).
    for (
      let cursor = Date.UTC(first.year, first.month - 1, first.day);
      cursor <= Date.UTC(last.year, last.month - 1, last.day);
      cursor += DAY_MS
    ) {
      const date = new Date(cursor);
      const calendarDay = {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
      };
      const weekDay = WEEK_DAY_BY_INDEX[date.getUTCDay()];

      for (const day of days.filter((item) => item.weekDay === weekDay)) {
        const [hours, minutes] = formatTimeOfDay(day.startTime)
          .split(":")
          .map(Number);
        const startAt = zonedToUtc(
          { ...calendarDay, hours, minutes },
          timeZone,
        );
        if (startAt >= start && startAt < to) {
          starts.push(startAt);
        }
      }
    }

    return starts;
  }

  // Sessão que existe → item da agenda.
  private toAgendaItem(
    session: SessionWithParticipants,
  ): ClassSessionAgendaItem {
    return {
      id: session.id,
      classGroup: session.classGroup,
      service: session.service,
      professional: session.professional,
      startAt: session.startAt,
      endAt: session.endAt,
      capacity: session.capacity,
      ...this.seatsOf(session),
      overBooking: session.overBooking,
      cancelledAt: session.cancelledAt,
      cancellationNote: session.cancellationNote,
      appointments: session.appointments,
    };
  }

  /**
   * Vagas ocupadas (agendamentos não cancelados; a falta ocupa) e livres. A
   * sessão cancelada não tem vaga livre: não recebe mais alunos.
   */
  private seatsOf({
    capacity,
    cancelledAt,
    appointments,
  }: Pick<
    SessionWithParticipants,
    "capacity" | "cancelledAt" | "appointments"
  >) {
    const occupied = appointments.filter(
      (appointment) => appointment.status !== AppointmentStatus.CANCELLED,
    ).length;

    return {
      occupied,
      available: cancelledAt ? 0 : Math.max(capacity - occupied, 0),
    };
  }

  // Com a sessão travada: confere a vaga e se o cliente já está nela, e cria o agendamento.
  private async enrollLocked(
    tx: Prisma.TransactionClient,
    locked: LockedSession,
    dto: EnrollClassSessionParticipantDto,
    session: SessionForEnrollment,
  ): Promise<AppointmentWithRelations> {
    await this.ensureHasSeatFor(tx, locked, dto.clientId);

    return this.appointmentService.createInClassSession(tx, {
      companyId: session.companyId,
      classSessionId: locked.id,
      clientId: dto.clientId,
      professionalId: session.professionalId,
      serviceId: session.serviceId,
      startAt: session.startAt,
      endAt: session.endAt,
      overBooking: session.overBooking,
      note: dto.note,
    });
  }

  // Sessão travada: não cancelada, com vaga e sem o cliente entre os alunos.
  private async ensureHasSeatFor(
    tx: Prisma.TransactionClient,
    locked: LockedSession,
    clientId: string,
  ): Promise<void> {
    this.ensureNotCancelled(locked);

    const occupied = await tx.appointment.count({
      where: { classSessionId: locked.id, status: OCCUPYING },
    });
    if (occupied >= locked.capacity) {
      throw new ConflictException(
        `A sessão está cheia (${locked.capacity} vagas)`,
      );
    }

    const alreadyIn = await tx.appointment.findFirst({
      where: { classSessionId: locked.id, clientId, status: OCCUPYING },
      select: { id: true },
    });
    if (alreadyIn) {
      throw new ConflictException("O cliente já está nesta sessão");
    }
  }

  /**
   * Sessão de um horário da turma fixa, travada até o fim da transação. Cria a
   * sessão se ainda não existir, sem erro quando outra requisição a criou ao
   * mesmo tempo (o índice único decide): um erro de unicidade abortaria a
   * transação no Postgres, e o ON CONFLICT evita isso. Os valores vão como
   * parâmetros, sem concatenar texto.
   */
  private async lockClassGroupSession(
    tx: Prisma.TransactionClient,
    classGroup: ClassGroupForSession,
    startAt: Date,
    endAt: Date,
  ): Promise<LockedSession> {
    await tx.$executeRaw`
      INSERT INTO "class_sessions"
        ("id", "companyId", "classGroupId", "serviceId", "professionalId",
         "startAt", "endAt", "capacity", "overBooking")
      VALUES
        (${randomUUID()}, ${classGroup.companyId}, ${classGroup.id}, ${classGroup.serviceId},
         ${classGroup.professionalId}, ${startAt}, ${endAt}, ${classGroup.capacity}, false)
      ON CONFLICT ("classGroupId", "startAt") WHERE "classGroupId" IS NOT NULL
      DO NOTHING`;
    const [locked] = await tx.$queryRaw<LockedSession[]>`
      SELECT "id", "capacity", "cancelledAt" FROM "class_sessions"
      WHERE "classGroupId" = ${classGroup.id} AND "startAt" = ${startAt}
      FOR UPDATE`;

    return locked;
  }

  // Trava a linha da sessão até o fim da transação (as outras inclusões esperam).
  private async lock(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<LockedSession> {
    const [locked] = await tx.$queryRaw<LockedSession[]>`
      SELECT "id", "capacity", "cancelledAt" FROM "class_sessions"
      WHERE "id" = ${id}
      FOR UPDATE`;

    return locked;
  }

  private async findInCompany(id: string, companyId: string) {
    const session = await this.prisma.classSession.findFirst({
      where: { id, companyId },
    });
    if (!session) {
      throw new NotFoundException("Sessão da turma não encontrada");
    }

    return session;
  }

  private async ensureClassGroupIsActive(classGroupId: string): Promise<void> {
    const classGroup = await this.prisma.classGroup.findUniqueOrThrow({
      where: { id: classGroupId },
      select: { isActive: true },
    });
    if (!classGroup.isActive) {
      throw new ConflictException("A turma está inativa");
    }
  }

  private ensureNotCancelled(locked: LockedSession): void {
    if (locked.cancelledAt) {
      throw new ConflictException("A sessão da turma foi cancelada");
    }
  }

  // Aluno só é encaixado (e a sessão só é cancelada) antes de a aula começar.
  private ensureHasNotStarted(
    startAt: Date,
    message = "A sessão já começou: não recebe novos alunos",
  ): void {
    if (startAt <= new Date()) {
      throw new BadRequestException(message);
    }
  }

  // O serviço precisa continuar ativo e aceitando turma; devolve a duração.
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

  private async ensureClient(clientId: string, companyId: string) {
    const client = await this.peopleService.findOne(clientId, companyId);
    if (client.type !== PeopleType.CLIENT) {
      throw new BadRequestException(
        "clientId deve ser uma pessoa do tipo CLIENT",
      );
    }
  }

  // O início precisa ser um dos horários da turma, no relógio da empresa (minuto exato).
  private ensureMatchesClassGroupDay(
    startAt: Date,
    days: { weekDay: string; startTime: Date }[],
    timeZone: string,
  ): void {
    const weekDay =
      WEEK_DAY_BY_INDEX[weekDayIndexOf(toZonedParts(startAt, timeZone))];
    const minutes = minutesOfZonedDay(startAt, timeZone);
    const exactMinute = startAt.getTime() % 60_000 === 0;

    const matches =
      exactMinute &&
      days.some(
        (day) =>
          day.weekDay === weekDay &&
          minutesOf(formatTimeOfDay(day.startTime)) === minutes,
      );

    if (!matches) {
      throw new BadRequestException(
        `A turma não tem horário em ${formatZonedDateTime(startAt, timeZone)}`,
      );
    }
  }
}
