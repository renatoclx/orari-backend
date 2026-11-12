import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Appointment, Prisma } from "../../../generated/prisma/client";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { PeopleType, WeekDay } from "../../../generated/prisma/enums";
import {
  APPOINTMENT_EVENTS,
  type AppointmentEvent,
} from "../../common/events/appointment-events";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { formatTimeOfDay, parseTimeOfDay } from "../../common/time/time-of-day";
import { toZonedParts } from "../../common/time/time-zone";
import { isRecordNotFound } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { LONG_TRANSACTION_TIMEOUT_MS } from "../../prisma/transaction-options";
import { AppointmentService } from "../appointment/appointment.service";
import { CompanyService } from "../company/company.service";
import { SettlePaymentsDto } from "../payment/dto/settle-payments.dto";
import { PaymentService } from "../payment/payment.service";
import { ClassSessionService } from "../class-group/class-session.service";
import { PeopleService } from "../people/people.service";
import { ServiceService } from "../service/service.service";
import { CreateRecurringAppointmentDto } from "./dto/create-recurring-appointment.dto";
import { FindRecurringAppointmentsQueryDto } from "./dto/find-recurring-appointments-query.dto";
import { RecurringDayDto } from "./dto/recurring-day.dto";
import { LeaveClassGroupDto } from "./dto/leave-class-group.dto";
import {
  ReplaceInClassGroupDto,
  RescheduleAppointmentDto,
} from "./dto/reschedule-appointment.dto";
import { UpdateRecurringAppointmentDto } from "./dto/update-recurring-appointment.dto";
import {
  buildOccurrences,
  isBeforeOrSameDay,
  minutesBetween,
  toDateParts,
} from "./recurrence-occurrences";

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
  // Preenchido quando a recorrência é a agenda de um serviço de um plano contratado.
  clientPlanId: string | null;
  // Turma fixa em que a recorrência está encaixada.
  classGroupId: string | null;
  // Saída da turma: quando o aluno saiu e o motivo.
  classLeftAt: Date | null;
  classLeaveNote: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  days: RecurringDayDto[];
  client: { id: string; name: string; photoUrl: string | null };
  professional: { id: string; name: string; photoUrl: string | null };
  service: {
    id: string;
    name: string;
    color: string | null;
    duration: number;
  };
}

// Agenda de um serviço de um plano contratado. O período vem da contratação.
export interface ClientPlanSchedule {
  clientPlanId: string;
  clientId: string;
  professionalId: string;
  serviceId: string;
  startDate: Date;
  endDate: Date;
  days: RecurringDayDto[];
  classGroupId?: string;
}

// O que toda recorrência grava, seja avulsa ou de plano.
interface ScheduleData {
  companyId: string;
  clientId: string;
  professionalId: string;
  serviceId: string;
  startDate: Date;
  endDate: Date;
  note?: string;
  clientPlanId?: string;
  classGroupId?: string;
  days: RecurringDayDto[];
}

// Resultado da baixa em lote dos pagamentos de uma recorrência.
export interface SettlePaymentsResponse {
  settled: number;
}

/**
 * Dias da recorrência e os dados relacionados que a tela desenha sem novas
 * chamadas (só o necessário). As relações são lidas pela chave, sem filtrar
 * exclusão lógica: pessoa ou serviço excluídos continuam com o nome.
 */
const withDetails = {
  include: {
    days: { orderBy: { startTime: "asc" } },
    client: { select: { id: true, name: true, photoUrl: true } },
    professional: { select: { id: true, name: true, photoUrl: true } },
    service: { select: { id: true, name: true, color: true, duration: true } },
  },
} satisfies Prisma.RecurringAppointmentDefaultArgs;

type RecurringAppointmentWithDetails = Prisma.RecurringAppointmentGetPayload<
  typeof withDetails
>;

/**
 * Agendamentos recorrentes pertencem à empresa do usuário autenticado; os de
 * outras empresas se comportam como inexistentes (404).
 *
 * Não existe exclusão (ver docs/domain/recorrencias.md): a recorrência é desativada por isActive.
 * Os dias fazem parte da recorrência e são substituídos em bloco.
 *
 * Este service não grava Appointment diretamente: ele calcula QUANDO cada
 * ocorrência deveria acontecer (buildOccurrences) e delega a criação/
 * cancelamento ao AppointmentService (createFromRecurrence,
 * cancelFutureFromRecurrence), que é quem valida janela de atendimento e
 * conflito de horário. Por isso as regras de agenda em si ficam lá, não aqui.
 * Do mesmo modo, os pagamentos de cada agendamento são gravados pelo
 * PaymentService, na mesma transação.
 *
 * A agenda não é regenerada: depois de criada, a recorrência só muda a
 * observação ou é cancelada. Mudar o padrão é encerrar e criar outra.
 */
@Injectable()
export class RecurringAppointmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly peopleService: PeopleService,
    private readonly serviceService: ServiceService,
    private readonly appointmentService: AppointmentService,
    private readonly companyService: CompanyService,
    private readonly paymentService: PaymentService,
    private readonly classSessionService: ClassSessionService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Anuncia, depois de gravar, a mudança numa sessão só (remanejar, repor,
   * cancelar). Criar e cancelar a recorrência inteira não são anunciados:
   * seriam dezenas de avisos de uma vez.
   */
  private announce(
    event: (typeof APPOINTMENT_EVENTS)["rescheduled" | "cancelled"],
    { id, companyId }: Appointment,
  ): void {
    const payload: AppointmentEvent = { appointmentId: id, companyId };
    this.events.emit(event, payload);
  }

  async create(
    dto: CreateRecurringAppointmentDto,
    companyId: string,
  ): Promise<RecurringAppointmentResponse> {
    await this.ensureParticipants(dto.clientId, dto.professionalId, companyId);
    // O serviço precisa ser buscado antes de validar os dias: a duração dele
    // é o que define quantos minutos cada dia precisa reservar.
    const service = await this.serviceService.findActive(
      dto.serviceId,
      companyId,
    );
    // O valor de cada agendamento é o preço vigente do serviço.
    const price = this.ensureServiceHasPrice(service.price);
    // Valida o período antes de gravar: a data final não pode vir antes da inicial.
    this.ensurePeriodIsValid(dto.startDate, dto.endDate);
    this.ensureDaysAreValid(dto.days, service.duration);
    if (dto.classGroupId) {
      await this.classSessionService.ensureRecurrenceFitsClassGroup(
        dto.classGroupId,
        dto,
        companyId,
      );
    }

    const timeZone = await this.companyService.getTimeZone(companyId);

    // Recorrência, agendamentos e pagamentos nascem juntos: se algum horário
    // conflitar, nada é gravado. Sem limite de período, uma recorrência longa
    // gera centenas de agendamentos, por isso o tempo da transação é maior.
    const created = await this.prisma.$transaction(
      async (tx) => {
        const { recurring, appointments } = await this.createSchedule(
          tx,
          { ...dto, companyId },
          service.duration,
          timeZone,
        );

        // Só a recorrência avulsa cobra por agendamento; a de plano é cobrada pela contratação.
        await this.paymentService.createPendingForAppointments(
          tx,
          companyId,
          appointments,
          price,
          timeZone,
        );

        return recurring;
      },
      { timeout: LONG_TRANSACTION_TIMEOUT_MS },
    );

    return this.toResponse(created);
  }

  /**
   * Cria a agenda de um serviço de um plano contratado, dentro da transação da
   * contratação: plano, agendas e pagamentos são gravados juntos ou nada é.
   *
   * Diferente da recorrência avulsa: o período é o da contratação e não há
   * pagamento por agendamento (a contratação é cobrada como um todo). As regras
   * de agenda continuam as mesmas.
   */
  async createForClientPlan(
    tx: Prisma.TransactionClient,
    schedule: ClientPlanSchedule,
    companyId: string,
    timeZone: string,
  ): Promise<RecurringAppointmentResponse> {
    await this.ensureParticipants(
      schedule.clientId,
      schedule.professionalId,
      companyId,
    );
    const service = await this.serviceService.findActive(
      schedule.serviceId,
      companyId,
    );
    this.ensureDaysAreValid(schedule.days, service.duration);
    if (schedule.classGroupId) {
      await this.classSessionService.ensureRecurrenceFitsClassGroup(
        schedule.classGroupId,
        schedule,
        companyId,
      );
    }

    const { recurring } = await this.createSchedule(
      tx,
      { ...schedule, companyId },
      service.duration,
      timeZone,
    );

    return this.toResponse(recurring);
  }

  /**
   * Cancelamento de uma contratação: encerra as recorrências dos serviços do
   * plano e cancela os agendamentos futuros ainda em SCHEDULED ou CONFIRMED, dentro da
   * transação da contratação. O PATCH comum não encerra recorrência de plano;
   * este é o único caminho.
   */
  async endForClientPlan(
    tx: Prisma.TransactionClient,
    clientPlanId: string,
    companyId: string,
  ): Promise<void> {
    const recurrences = await tx.recurringAppointment.findMany({
      where: { clientPlanId, companyId, isActive: true },
      select: { id: true },
    });
    const ids = recurrences.map((recurrence) => recurrence.id);
    const now = new Date();

    await tx.recurringAppointment.updateMany({
      where: { id: { in: ids } },
      data: { isActive: false, updatedAt: now },
    });

    for (const id of ids) {
      await this.appointmentService.cancelFutureFromRecurrence(tx, id, now);
    }
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
        ...withDetails,
        // O id desempata recorrências com o mesmo início: sem ele, a paginação
        // pode repetir ou pular itens entre uma página e outra.
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
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
      ...withDetails,
    });

    if (!recurring) {
      throw new NotFoundException("Agendamento recorrente não encontrado");
    }

    return this.toResponse(recurring);
  }

  /**
   * Só a observação muda, ou a recorrência é cancelada (isActive = false).
   * Cancelar libera os horários futuros e cancela os pagamentos pendentes deles.
   */
  async update(
    id: string,
    dto: UpdateRecurringAppointmentDto,
    companyId: string,
  ): Promise<RecurringAppointmentResponse> {
    const current = await this.findOne(id, companyId);
    if (dto.isActive === false && current.clientPlanId) {
      throw new BadRequestException(
        "A recorrência de um plano é encerrada pelo cancelamento da contratação",
      );
    }
    // Cancelar de novo uma recorrência já cancelada não tem o que desfazer.
    const cancels = dto.isActive === false && current.isActive;

    const updated = await this.prisma.$transaction(async (tx) => {
      const recurring = await tx.recurringAppointment.update({
        where: { id },
        data: { ...dto, updatedAt: new Date() },
        ...withDetails,
      });

      if (cancels) {
        // Agendamentos antes dos pagamentos: o cancelamento dos pagamentos
        // procura os agendamentos que acabaram de ser cancelados.
        const now = new Date();
        await this.appointmentService.cancelFutureFromRecurrence(tx, id, now);
        await this.paymentService.cancelPendingForRecurrence(tx, id, now);
      }

      return recurring;
    });

    return this.toResponse(updated);
  }

  // Baixa em lote: o cliente que paga a recorrência inteira de uma vez.
  async settlePayments(
    id: string,
    dto: SettlePaymentsDto,
    companyId: string,
  ): Promise<SettlePaymentsResponse> {
    // Garante que a recorrência existe e é da empresa (404 caso contrário).
    await this.findOne(id, companyId);

    const settled = await this.paymentService.settlePendingForRecurrence(
      id,
      dto,
      companyId,
    );

    return { settled };
  }

  /**
   * Remanejamento: move um agendamento da recorrência para outro dia e horário
   * dentro do período dela. Agendamento e vencimento do pagamento mudam juntos,
   * na mesma transação.
   */
  async rescheduleAppointment(
    id: string,
    appointmentId: string,
    { startAt }: RescheduleAppointmentDto,
    companyId: string,
  ): Promise<Appointment> {
    const { recurring, appointment } = await this.findActiveOccurrence(
      id,
      appointmentId,
      companyId,
    );

    const timeZone = await this.companyService.getTimeZone(companyId);
    this.ensureWithinPeriod(startAt, recurring, timeZone);

    const rescheduled = await this.prisma.$transaction(async (tx) => {
      const moved = await this.appointmentService.rescheduleFromRecurrence(
        tx,
        appointment,
        startAt,
        // Só o pacote tem reposição (falta e aula cancelada pela turma).
        { allowReplacement: Boolean(recurring.clientPlanId) },
      );
      await this.paymentService.moveDueDate(
        tx,
        appointmentId,
        startAt,
        timeZone,
      );

      return moved;
    });
    this.announce(APPOINTMENT_EVENTS.rescheduled, appointment);
    return rescheduled;
  }

  /**
   * Reposição (ou remanejamento) numa sessão de turma fixa, da mesma turma ou de
   * outra do mesmo serviço, dentro do período da recorrência. Aceita as mesmas
   * aulas do remanejamento comum (ver rescheduleAppointment); a aula passa a ser
   * com o profissional da turma de destino, e a recorrência mantém o dela. Vaga,
   * agendamento e vencimento do pagamento mudam juntos, na mesma transação.
   */
  async replaceInClassGroup(
    id: string,
    appointmentId: string,
    { classGroupId, startAt }: ReplaceInClassGroupDto,
    companyId: string,
  ): Promise<Appointment> {
    const { recurring, appointment } = await this.findActiveOccurrence(
      id,
      appointmentId,
      companyId,
    );

    const timeZone = await this.companyService.getTimeZone(companyId);
    this.ensureWithinPeriod(startAt, recurring, timeZone);
    const slot = await this.classSessionService.resolveClassGroupSlot(
      classGroupId,
      { serviceId: appointment.serviceId, startAt },
      companyId,
      timeZone,
    );

    const replaced = await this.prisma.$transaction(async (tx) => {
      // A agenda vem antes da vaga (ver AppointmentService.lockAgenda).
      await this.appointmentService.lockAgenda(tx, {
        professionalIds: [slot.classGroup.professionalId],
        clientIds: [appointment.clientId],
      });
      // A vaga fica travada até o fim da transação.
      const classSession = await this.classSessionService.reserveSeat(
        tx,
        slot,
        appointment.clientId,
      );
      const moved = await this.appointmentService.rescheduleFromRecurrence(
        tx,
        appointment,
        startAt,
        { allowReplacement: Boolean(recurring.clientPlanId), classSession },
      );
      await this.paymentService.moveDueDate(
        tx,
        appointmentId,
        startAt,
        timeZone,
      );

      return moved;
    });
    this.announce(APPOINTMENT_EVENTS.rescheduled, appointment);
    return replaced;
  }

  /**
   * Saída da turma: grava a data e o motivo e cancela as aulas futuras da
   * recorrência na turma (com o motivo, que permite repor as sessões de plano),
   * e os pagamentos pendentes delas, na mesma transação.
   *
   * A recorrência avulsa é encerrada, porque todos os dias dela são horários da
   * turma; para entrar em outra, cria-se uma recorrência nova. A de plano
   * continua ativa (só o cancelamento da contratação a encerra), e as aulas
   * canceladas ficam para reposição.
   */
  async leaveClassGroup(
    id: string,
    { note }: LeaveClassGroupDto,
    companyId: string,
  ): Promise<RecurringAppointmentResponse> {
    const current = await this.findOne(id, companyId);
    if (!current.isActive) {
      throw new BadRequestException(
        "Recorrência cancelada não sai da turma: as aulas já foram canceladas",
      );
    }
    if (!current.classGroupId) {
      throw new BadRequestException(
        "A recorrência não está encaixada numa turma",
      );
    }
    if (current.classLeftAt) {
      throw new ConflictException("O aluno já saiu da turma");
    }
    const { classGroupId } = current;
    const endsRecurrence = !current.clientPlanId;

    const updated = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      let recurring: RecurringAppointmentWithDetails;
      try {
        // O filtro pela saída vazia barra duas saídas simultâneas (409).
        recurring = await tx.recurringAppointment.update({
          where: { id, classLeftAt: null },
          data: {
            classLeftAt: now,
            classLeaveNote: note ?? null,
            isActive: endsRecurrence ? false : undefined,
            updatedAt: now,
          },
          ...withDetails,
        });
      } catch (error) {
        throw isRecordNotFound(error)
          ? new ConflictException("O aluno já saiu da turma")
          : error;
      }

      // Agendamentos antes dos pagamentos: o cancelamento dos pagamentos
      // procura os agendamentos que acabaram de ser cancelados.
      await this.appointmentService.cancelFutureFromClassGroup(
        tx,
        id,
        classGroupId,
        now,
      );
      if (endsRecurrence) {
        // As aulas remanejadas para fora da turma também acabam com a recorrência.
        await this.appointmentService.cancelFutureFromRecurrence(tx, id, now);
      }
      await this.paymentService.cancelPendingForRecurrence(tx, id, now);

      return recurring;
    });

    return this.toResponse(updated);
  }

  /**
   * Cancela um único agendamento da recorrência. O horário fica livre e o
   * pagamento pendente dele é cancelado, na mesma transação.
   */
  async cancelAppointment(
    id: string,
    appointmentId: string,
    companyId: string,
  ): Promise<Appointment> {
    const { appointment } = await this.findActiveOccurrence(
      id,
      appointmentId,
      companyId,
    );

    const cancelled = await this.prisma.$transaction(async (tx) => {
      const done = await this.appointmentService.cancelFromRecurrence(
        tx,
        appointment,
      );
      await this.paymentService.cancelPendingForAppointment(tx, appointmentId);

      return done;
    });
    this.announce(APPOINTMENT_EVENTS.cancelled, appointment);
    return cancelled;
  }

  /**
   * Busca um agendamento que pertence a uma recorrência ativa da empresa.
   * Agendamento de outra recorrência se comporta como inexistente (404).
   */
  private async findActiveOccurrence(
    id: string,
    appointmentId: string,
    companyId: string,
  ) {
    const recurring = await this.findOne(id, companyId);
    if (!recurring.isActive) {
      throw new BadRequestException(
        "Recorrência cancelada não aceita alterações em seus agendamentos",
      );
    }

    const appointment = await this.appointmentService.findOne(
      appointmentId,
      companyId,
    );
    if (appointment.recurringAppointmentId !== id) {
      throw new NotFoundException(
        "Agendamento não encontrado nesta recorrência",
      );
    }

    return { recurring, appointment };
  }

  /**
   * Parte comum a toda recorrência: grava a recorrência com os dias e gera os
   * agendamentos do período, na transação de quem chama. O AppointmentService
   * valida janela de atendimento e conflito de horário de cada ocorrência.
   */
  private async createSchedule(
    tx: Prisma.TransactionClient,
    { days, ...data }: ScheduleData,
    serviceDuration: number,
    timeZone: string,
  ) {
    // A agenda é travada antes das vagas da turma (reserveForOccurrences), na
    // ordem que evita deadlock (ver AppointmentService.lockAgenda).
    await this.appointmentService.lockAgenda(tx, {
      professionalIds: [data.professionalId],
      clientIds: [data.clientId],
    });
    const recurring = await tx.recurringAppointment.create({
      data: { ...data, days: { create: this.toDayRows(days) } },
      ...withDetails,
    });

    const occurrences = buildOccurrences(
      days,
      recurring.startDate,
      data.endDate,
      serviceDuration,
      timeZone,
      new Date(),
    );

    const appointments = await this.appointmentService.createFromRecurrence(
      tx,
      {
        companyId: data.companyId,
        recurringAppointmentId: recurring.id,
        clientId: recurring.clientId,
        professionalId: recurring.professionalId,
        serviceId: recurring.serviceId,
      },
      // Na turma, cada ocorrência vai para a sessão do horário, com a vaga
      // reservada (e travada) até o fim da transação.
      data.classGroupId
        ? await this.classSessionService.reserveForOccurrences(
            tx,
            data.classGroupId,
            occurrences,
            timeZone,
          )
        : occurrences,
      timeZone,
      recurring.note,
    );

    return { recurring, appointments };
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

  // Serviço sem preço não tem como definir o valor dos pagamentos.
  private ensureServiceHasPrice(price: Decimal | null): Decimal {
    if (price === null) {
      throw new BadRequestException(
        "O serviço precisa ter preço para ser usado em uma recorrência",
      );
    }

    return price;
  }

  // O período vai da data inicial à final, sem limite de duração: o front define o prazo.
  private ensurePeriodIsValid(startDate: Date, endDate: Date) {
    if (endDate < startDate) {
      throw new BadRequestException("endDate deve ser posterior a startDate");
    }
  }

  /**
   * A nova data, no calendário da empresa, precisa cair entre o início e o fim
   * da recorrência. Recorrências antigas sem data final só têm o limite inicial.
   */
  private ensureWithinPeriod(
    startAt: Date,
    {
      startDate,
      endDate,
    }: Pick<RecurringAppointmentResponse, "startDate" | "endDate">,
    timeZone: string,
  ) {
    const day = toZonedParts(startAt, timeZone);

    const withinPeriod =
      isBeforeOrSameDay(toDateParts(startDate), day) &&
      (!endDate || isBeforeOrSameDay(day, toDateParts(endDate)));

    if (!withinPeriod) {
      throw new BadRequestException(
        "A nova data precisa estar dentro do período da recorrência",
      );
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
      if (minutesBetween(day.startTime, day.endTime) < serviceDuration) {
        throw new BadRequestException(
          `Cada dia deve reservar ao menos ${serviceDuration} minutos, a duração do serviço`,
        );
      }
    }

    // Agrupa por dia da semana e ordena cada grupo por horário de início: assim,
    // uma sobreposição só pode acontecer entre vizinhos na lista ordenada — não
    // é preciso comparar todos os pares com todos.
    const byWeekDay = new Map<WeekDay, RecurringDayDto[]>();
    for (const day of days) {
      byWeekDay.set(day.weekDay, [...(byWeekDay.get(day.weekDay) ?? []), day]);
    }

    for (const [weekDay, sameDay] of byWeekDay) {
      const ordered = [...sameDay].sort((a, b) =>
        a.startTime.localeCompare(b.startTime),
      );

      // Basta comparar cada dia com o anterior (já ordenado): se o início dele
      // vem antes do fim do anterior, os dois se sobrepõem.
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

  private toDayRows(days: RecurringDayDto[]) {
    return days.map(({ weekDay, startTime, endTime }) => ({
      weekDay,
      startTime: parseTimeOfDay(startTime),
      endTime: parseTimeOfDay(endTime),
    }));
  }

  private toResponse(
    recurring: RecurringAppointmentWithDetails,
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
