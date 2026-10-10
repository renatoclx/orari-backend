import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Appointment, Prisma } from "../../../generated/prisma/client";
import { AppointmentStatus, PeopleType } from "../../../generated/prisma/enums";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { BusinessHourService } from "../business-hour/business-hour.service";
import { PeopleService } from "../people/people.service";
import { ServiceService } from "../service/service.service";
import { CreateAppointmentDto } from "./dto/create-appointment.dto";
import { FindAppointmentsQueryDto } from "./dto/find-appointments-query.dto";
import { UpdateAppointmentDto } from "./dto/update-appointment.dto";

// Um agendamento cancelado libera o horário do cliente e do profissional.
const BLOCKING_STATUSES = { not: AppointmentStatus.CANCELLED } as const;

// Só um atendimento que ainda não aconteceu pode ser remanejado ou cancelado
// pela recorrência.
const UPCOMING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
];

// O que foi contratado na recorrência: só o remanejamento muda data e horário.
const RECURRENCE_LOCKED_FIELDS = [
  "startAt",
  "serviceId",
  "clientId",
  "professionalId",
] as const;

// Um horário que a recorrência quer ocupar.
export interface AppointmentOccurrence {
  startAt: Date;
  endAt: Date;
}

// Dados que a recorrência repete em todos os agendamentos que gera.
export interface RecurrenceAppointmentData {
  companyId: string;
  recurringAppointmentId: string;
  clientId: string;
  professionalId: string;
  serviceId: string;
}

// Aceita tanto o PrismaService quanto o cliente de uma transação em andamento
// (tx dentro de $transaction tem outro tipo no Prisma). Necessário porque
// createFromRecurrence/cancelFutureFromRecurrence rodam dentro da transação
// aberta pelo RecurringAppointmentService, e precisam gravar com o mesmo `tx`
// — nunca com o `this.prisma` direto, ou ficariam fora da transação.
// Pick previne re repetir dados manualmente
type PrismaClientLike = Pick<PrismaService, "appointment">;

// Campos que o job de cobrança precisa para gerar o pagamento de um agendamento
// avulso concluído.
const completedStandaloneSelect = {
  id: true,
  companyId: true,
  startAt: true,
  service: { select: { price: true } },
  company: { select: { timezone: true } },
} satisfies Prisma.AppointmentSelect;

export type CompletedStandaloneAppointment = Prisma.AppointmentGetPayload<{
  select: typeof completedStandaloneSelect;
}>;

/**
 * Agendamentos pertencem à empresa do usuário autenticado; os de outras empresas
 * se comportam como inexistentes (404).
 *
 * Não existe exclusão (ver domain.md): o ciclo de vida é controlado pelo status,
 * e cancelar é mudar o status para CANCELLED.
 *
 * createFromRecurrence e cancelFutureFromRecurrence existem para serem
 * chamados pelo RecurringAppointmentService (nunca por um controller): é aqui
 * que ficam as regras de conflito de horário e janela de atendimento, e a
 * recorrência as reaproveita em vez de duplicá-las.
 */
@Injectable()
export class AppointmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly peopleService: PeopleService,
    private readonly serviceService: ServiceService,
    private readonly businessHourService: BusinessHourService,
  ) {}

  // Ordem das checagens: primeiro as baratas e sem banco (data no futuro),
  // depois as que dependem de outras entidades, e por último as que batem
  // contra a agenda (janela de atendimento, depois conflito de horário) — a
  // mais cara é a última, para não gastar uma consulta de conflito num
  // agendamento que já ia falhar por outro motivo.
  async create(
    dto: CreateAppointmentDto,
    companyId: string,
  ): Promise<Appointment> {
    this.ensureIsNotInThePast(dto.startAt);
    await this.ensureParticipants(dto.clientId, dto.professionalId, companyId);

    const endAt = await this.resolveEndAt(
      dto.serviceId,
      dto.startAt,
      companyId,
    );
    await this.businessHourService.ensureWithinBusinessHours(
      companyId,
      dto.startAt,
      endAt,
    );
    await this.ensureSlotIsFree(this.prisma, { ...dto, endAt }, companyId);

    return this.prisma.appointment.create({
      data: { ...dto, endAt, companyId },
    });
  }

  async findAll(
    {
      page,
      limit,
      status,
      professionalId,
      clientId,
      from,
      to,
    }: FindAppointmentsQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<Appointment>> {
    const where: Prisma.AppointmentWhereInput = {
      companyId,
      status,
      professionalId,
      clientId,
      startAt: from || to ? { gte: from, lt: to } : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        // A agenda é lida em ordem cronológica, e não por data de cadastro.
        orderBy: { startAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, companyId: string): Promise<Appointment> {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, companyId },
    });

    if (!appointment) {
      throw new NotFoundException("Agendamento não encontrado");
    }

    return appointment;
  }

  async update(
    id: string,
    dto: UpdateAppointmentDto,
    companyId: string,
  ): Promise<Appointment> {
    const appointment = await this.findOne(id, companyId);

    if (appointment.recurringAppointmentId) {
      this.ensureRecurrenceTermsUnchanged(dto);
    }

    // Estado final do agendamento, considerando o que veio no PATCH.
    const clientId = dto.clientId ?? appointment.clientId;
    const professionalId = dto.professionalId ?? appointment.professionalId;
    const serviceId = dto.serviceId ?? appointment.serviceId;
    const startAt = dto.startAt ?? appointment.startAt;
    const status = dto.status ?? appointment.status;

    // Só remarcar exige data futura: editar status ou observação de um
    // agendamento que já passou continua permitido.
    if (dto.startAt) {
      this.ensureIsNotInThePast(dto.startAt);
    }

    if (dto.clientId || dto.professionalId) {
      await this.ensureParticipants(clientId, professionalId, companyId);
    }

    // O fim depende do serviço e do início; só recalcula quando um deles muda.
    const endAt =
      dto.serviceId || dto.startAt
        ? await this.resolveEndAt(serviceId, startAt, companyId)
        : appointment.endAt;

    // Um agendamento cancelado não disputa horário nem precisa caber na janela
    // de atendimento; os demais, sim.
    if (status !== AppointmentStatus.CANCELLED) {
      if (dto.serviceId || dto.startAt) {
        await this.businessHourService.ensureWithinBusinessHours(
          companyId,
          startAt,
          endAt,
        );
      }

      await this.ensureSlotIsFree(
        this.prisma,
        { clientId, professionalId, startAt, endAt },
        companyId,
        id,
      );
    }

    return this.prisma.appointment.update({
      where: { id },
      data: { ...dto, endAt, updatedAt: new Date() },
    });
  }

  /**
   * Remaneja um agendamento de recorrência para outro dia e horário, dentro da
   * transação de quem chama. É o mesmo registro: o pagamento continua ligado a
   * ele. Valem as regras de qualquer remarcação: data futura, janela de
   * atendimento e agenda livre para cliente e profissional.
   */
  async rescheduleFromRecurrence(
    db: PrismaClientLike,
    appointment: Appointment,
    startAt: Date,
  ): Promise<Appointment> {
    this.ensureIsUpcoming(appointment.status, "remanejado");
    this.ensureIsNotInThePast(startAt);

    const { companyId, clientId, professionalId } = appointment;
    const endAt = await this.resolveEndAt(
      appointment.serviceId,
      startAt,
      companyId,
    );
    await this.businessHourService.ensureWithinBusinessHours(
      companyId,
      startAt,
      endAt,
    );
    await this.ensureSlotIsFree(
      db,
      { clientId, professionalId, startAt, endAt },
      companyId,
      appointment.id,
    );

    return db.appointment.update({
      where: { id: appointment.id },
      data: { startAt, endAt, updatedAt: new Date() },
    });
  }

  /**
   * Cancela um agendamento de recorrência dentro da transação de quem chama,
   * que também cancela o pagamento dele. O horário volta a ficar livre.
   */
  async cancelFromRecurrence(
    db: PrismaClientLike,
    appointment: Appointment,
  ): Promise<Appointment> {
    this.ensureIsUpcoming(appointment.status, "cancelado");

    return db.appointment.update({
      where: { id: appointment.id },
      data: { status: AppointmentStatus.CANCELLED, updatedAt: new Date() },
    });
  }

  /**
   * Pelo PATCH comum, um agendamento de recorrência não muda data, serviço nem
   * participantes, e não é cancelado: remanejar e cancelar passam pela
   * recorrência, que também cuida do pagamento.
   */
  private ensureRecurrenceTermsUnchanged(dto: UpdateAppointmentDto) {
    const locked = RECURRENCE_LOCKED_FIELDS.filter(
      (field) => dto[field] !== undefined,
    );

    if (locked.length > 0) {
      throw new BadRequestException(
        `Agendamento de recorrência não aceita ${locked.join(", ")}: ` +
          "para mudar data e horário, use o remanejamento da recorrência",
      );
    }

    if (dto.status === AppointmentStatus.CANCELLED) {
      throw new BadRequestException(
        "Agendamento de recorrência é cancelado pelo cancelamento da recorrência",
      );
    }
  }

  private ensureIsUpcoming(status: AppointmentStatus, action: string) {
    if (!UPCOMING_STATUSES.includes(status)) {
      throw new BadRequestException(
        `Agendamento com status ${status} não pode ser ${action}`,
      );
    }
  }

  // Agendar exige horário futuro; a recorrência também nunca gera ocorrências passadas.
  private ensureIsNotInThePast(startAt: Date) {
    if (startAt <= new Date()) {
      throw new BadRequestException(
        "startAt deve ser uma data e hora no futuro",
      );
    }
  }

  // Cliente e profissional precisam ser pessoas da empresa, com o tipo correspondente.
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

  // O fim do atendimento é sempre o início mais a duração cadastrada no serviço.
  private async resolveEndAt(
    serviceId: string,
    startAt: Date,
    companyId: string,
  ): Promise<Date> {
    const service = await this.serviceService.findActive(serviceId, companyId);

    return new Date(startAt.getTime() + service.duration * 60_000);
  }

  /**
   * Recusa sobreposição de horário do mesmo profissional ou do mesmo cliente.
   *
   * Dois intervalos se sobrepõem quando um começa antes de o outro terminar e
   * termina depois de o outro começar; os limites que apenas se encostam
   * (fim == início) são permitidos. Agendamentos cancelados são ignorados, e na
   * edição o próprio agendamento é excluído da checagem.
   */
  private async ensureSlotIsFree(
    db: PrismaClientLike,
    {
      clientId,
      professionalId,
      startAt,
      endAt,
    }: {
      clientId: string;
      professionalId: string;
      startAt: Date;
      endAt: Date;
    },
    companyId: string,
    ignoreId?: string, // recebe o id de um agendamento, onde ele ignora o id na consulta
    occurrenceLabel?: string, // monta a mensagem de erro
  ) {
    const conflict = await db.appointment.findFirst({
      where: {
        companyId,
        status: BLOCKING_STATUSES,
        id: ignoreId ? { not: ignoreId } : undefined,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
        OR: [{ professionalId }, { clientId }],
      },
      select: { professionalId: true },
    });

    if (conflict) {
      const who =
        conflict.professionalId === professionalId ? "profissional" : "cliente";

      throw new ConflictException(
        occurrenceLabel
          ? `O ${who} já possui um agendamento em ${occurrenceLabel}`
          : `O ${who} já possui um agendamento neste horário`,
      );
    }
  }

  /**
   * Cria os agendamentos de uma recorrência dentro da transação informada.
   *
   * Cada ocorrência passa pelas mesmas regras de um agendamento avulso: precisa
   * caber na janela de atendimento e não pode conflitar com a agenda do cliente
   * nem do profissional. Como tudo roda na mesma transação, um conflito em
   * qualquer data desfaz a operação inteira — a recorrência não é criada pela
   * metade.
   */
  async createFromRecurrence(
    db: PrismaClientLike,
    data: RecurrenceAppointmentData,
    occurrences: AppointmentOccurrence[],
    note?: string | null,
  ): Promise<Pick<Appointment, "id" | "startAt">[]> {
    for (const { startAt, endAt } of occurrences) {
      await this.businessHourService.ensureWithinBusinessHours(
        data.companyId,
        startAt,
        endAt,
      );
      await this.ensureSlotIsFree(
        db,
        { ...data, startAt, endAt }, // Pega tudo que existe em data e adiciona startAt e endAt
        data.companyId,
        undefined,
        startAt.toISOString(),
      );
    }

    // Devolve id e início de cada agendamento: a recorrência precisa deles
    // para gerar os pagamentos na mesma transação.
    return db.appointment.createManyAndReturn({
      data: occurrences.map((occurrence) => ({
        ...data, // companyId e clientId
        ...occurrence, // startAt e endAt
        note: note ?? null,
      })),
      select: { id: true, startAt: true },
    });
  }

  /**
   * Cancela os agendamentos futuros ainda em SCHEDULED que vieram de uma
   * recorrência. Preserva o histórico: passados, confirmados, concluídos,
   * no-show e cancelados à mão não são tocados.
   */
  async cancelFutureFromRecurrence(
    db: PrismaClientLike,
    recurringAppointmentId: string,
    from: Date,
  ): Promise<number> {
    const { count } = await db.appointment.updateMany({
      where: {
        recurringAppointmentId,
        status: AppointmentStatus.SCHEDULED,
        startAt: { gte: from },
      },
      data: { status: AppointmentStatus.CANCELLED, updatedAt: new Date() },
    });

    return count;
  }

  /**
   * Avulsos concluídos que ainda não tiveram pagamento, de todas as empresas.
   * Só para o job de cobrança: não usar em rotas, que são restritas a uma empresa.
   */
  async findCompletedStandaloneWithoutPayment(): Promise<
    CompletedStandaloneAppointment[]
  > {
    return this.prisma.appointment.findMany({
      where: {
        status: AppointmentStatus.COMPLETED,
        // Recorrência e plano já têm a cobrança deles.
        recurringAppointmentId: null,
        // Não existe linha de pagamento ligada ao agendamento
        payment: { is: null },
        // Serviço sem preço é gratuito: não gera cobrança.
        service: { price: { not: null } },
      },
      select: completedStandaloneSelect,
    });
  }
}
