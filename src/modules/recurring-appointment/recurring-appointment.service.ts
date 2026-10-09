import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Appointment, Prisma } from "../../../generated/prisma/client";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
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
import { SettlePaymentsDto } from "../payment/dto/settle-payments.dto";
import { PaymentService } from "../payment/payment.service";
import { PeopleService } from "../people/people.service";
import { ServiceService } from "../service/service.service";
import { CreateRecurringAppointmentDto } from "./dto/create-recurring-appointment.dto";
import { FindRecurringAppointmentsQueryDto } from "./dto/find-recurring-appointments-query.dto";
import { RecurringDayDto } from "./dto/recurring-day.dto";
import { RescheduleAppointmentDto } from "./dto/reschedule-appointment.dto";
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

// Período máximo de uma recorrência avulsa (ver docs/business-rules.md).
export const MAX_RECURRENCE_DAYS = 60;

// Resultado da baixa em lote dos pagamentos de uma recorrência.
export interface SettlePaymentsResponse {
  settled: number;
}

// Um dia em milissegundos: usado para medir a distância entre duas datas puras.
const DAY_IN_MS = 86_400_000;

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
  ) {}

  async create(
    dto: CreateRecurringAppointmentDto,
    companyId: string,
  ): Promise<RecurringAppointmentResponse> {
    const { days, ...data } = dto;

    await this.ensureParticipants(dto.clientId, dto.professionalId, companyId);
    // O serviço precisa ser buscado antes de validar os dias: a duração dele
    // é o que define quantos minutos cada dia precisa reservar.
    const service = await this.serviceService.findActive(
      dto.serviceId,
      companyId,
    );
    // O valor de cada agendamento é o preço vigente do serviço.
    const price = this.ensureServiceHasPrice(service.price);
    // Valida o período antes de gravar: em ordem e com até 60 dias.
    this.ensurePeriodIsValid(dto.startDate, dto.endDate);
    this.ensureDaysAreValid(days, service.duration);

    const timeZone = await this.companyService.getTimeZone(companyId);

    // Recorrência, agendamentos e pagamentos nascem juntos: se algum horário
    // conflitar, nada é gravado.
    const created = await this.prisma.$transaction(async (tx) => {
      const recurring = await tx.recurringAppointment.create({
        data: { ...data, companyId, days: { create: this.toDayRows(days) } },
        ...withDays,
      });

      const appointments = await this.appointmentService.createFromRecurrence(
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
          dto.endDate,
          service.duration,
          timeZone,
          new Date(),
        ),
        recurring.note,
      );

      await this.paymentService.createPendingForAppointments(
        tx,
        companyId,
        appointments,
        price,
        timeZone,
      );

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
    // Cancelar de novo uma recorrência já cancelada não tem o que desfazer.
    const cancels = dto.isActive === false && current.isActive;

    const updated = await this.prisma.$transaction(async (tx) => {
      const recurring = await tx.recurringAppointment.update({
        where: { id },
        data: { ...dto, updatedAt: new Date() },
        ...withDays,
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

    return this.prisma.$transaction(async (tx) => {
      const rescheduled =
        await this.appointmentService.rescheduleFromRecurrence(
          tx,
          appointment,
          startAt,
        );
      await this.paymentService.moveDueDate(
        tx,
        appointmentId,
        startAt,
        timeZone,
      );

      return rescheduled;
    });
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

    return this.prisma.$transaction(async (tx) => {
      const cancelled = await this.appointmentService.cancelFromRecurrence(
        tx,
        appointment,
      );
      await this.paymentService.cancelPendingForAppointment(tx, appointmentId);

      return cancelled;
    });
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

  // O período vai da data inicial à final e não pode passar de MAX_RECURRENCE_DAYS.
  private ensurePeriodIsValid(startDate: Date, endDate: Date) {
    if (endDate < startDate) {
      throw new BadRequestException("endDate deve ser posterior a startDate");
    }

    const days = Math.round(
      (endDate.getTime() - startDate.getTime()) / DAY_IN_MS,
    );
    if (days > MAX_RECURRENCE_DAYS) {
      throw new BadRequestException(
        `O período da recorrência não pode passar de ${MAX_RECURRENCE_DAYS} dias`,
      );
    }
  }

  /**
   * A nova data, no calendário da empresa, precisa cair entre o início e o fim
   * da recorrência. Recorrências antigas sem data final usam o limite de
   * MAX_RECURRENCE_DAYS a partir do início.
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
    const lastDay =
      endDate ??
      new Date(startDate.getTime() + MAX_RECURRENCE_DAYS * DAY_IN_MS);

    const withinPeriod =
      this.isBeforeOrSameDay(this.toDateParts(startDate), day) &&
      this.isBeforeOrSameDay(day, this.toDateParts(lastDay));

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
      if (this.minutesBetween(day.startTime, day.endTime) < serviceDuration) {
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

  /**
   * Monta os horários que a recorrência ocupa.
   *
   * Gera do maior valor entre o início da recorrência e hoje (não se cria
   * histórico) até a data final. Cada ocorrência começa no horário reservado do
   * dia e termina conforme a duração do serviço.
   */
  private buildOccurrences(
    days: RecurringDayDto[],
    startDate: Date,
    endDate: Date,
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
     * `from` é um instante, e por isso é lido no fuso da empresa.
     */
    const cursor =
      startDate > from
        ? this.toDateParts(startDate)
        : toZonedParts(from, timeZone);

    // A geração termina na data final, que é obrigatória (não há mais horizonte).
    const limit = this.toDateParts(endDate);
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

  /*
   * As quatro funções abaixo (toDateParts, weekDayIndex, isBeforeOrSameDay,
   * advanceOneDay) formam um pequeno "kit de calendário"
   * usado só pelo buildOccurrences, para andar dia a dia entre o início e o
   * fim da recorrência.
   *
   * Por que não usar `Date` diretamente como cursor? Porque `Date` representa
   * um instante (amarrado a um fuso), e o que se quer aqui é andar por dias de
   * calendário "puros" (2026-10-01, 2026-10-02, ...), sem hora nem fuso — do
   * contrário, perto da virada do dia no fuso da empresa, o cursor correria o
   * risco de pular ou repetir um dia (mesmo problema explicado para
   * `startDate`/`endDate` no comentário de buildOccurrences). Por isso o
   * cursor é um objeto simples `{ year, month, day }`, e `Date.UTC(...)` entra
   * só como calculadora (ela já sabe lidar com "dia 32" virando o mês
   * seguinte, ano bissexto etc.), nunca como o valor guardado.
   */

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
