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

// Ocupam vaga todos os agendamentos da sessão, menos os cancelados (a falta ocupa).
const OCCUPYING = { not: AppointmentStatus.CANCELLED } as const;

// Só um agendamento que ainda não aconteceu vira turma.
const CONVERTIBLE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
];

// A sessão como a tela a mostra: vagas e alunos.
const withParticipants = {
  include: {
    classGroup: { select: { id: true, name: true } },
    service: { select: { id: true, name: true, color: true, duration: true } },
    professional: { select: { id: true, name: true, photoUrl: true } },
    appointments: {
      select: {
        id: true,
        status: true,
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

    const occupied = session.appointments.filter(
      (appointment) => appointment.status !== AppointmentStatus.CANCELLED,
    ).length;

    return {
      ...session,
      occupied,
      available: Math.max(session.capacity - occupied, 0),
    };
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
