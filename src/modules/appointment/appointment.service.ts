import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Appointment, Prisma } from "../../../generated/prisma/client";
import {
  AppointmentStatus,
  PaymentStatus,
  PeopleType,
} from "../../../generated/prisma/enums";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { toZonedParts } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { BusinessHourService } from "../business-hour/business-hour.service";
import { PeopleService } from "../people/people.service";
import { ServiceService } from "../service/service.service";
import { CreateAppointmentDto } from "./dto/create-appointment.dto";
import { FindAppointmentsQueryDto } from "./dto/find-appointments-query.dto";
import { UpdateAppointmentDto } from "./dto/update-appointment.dto";

/**
 * Dados relacionados que a agenda desenha sem novas chamadas: só o necessário
 * (nada de documento nem contatos). A relação é lida pela chave, sem filtrar
 * exclusão lógica: pessoa ou serviço excluídos continuam com o nome no
 * histórico dos agendamentos antigos.
 */
const withRelations = {
  client: { select: { id: true, name: true, photoUrl: true } },
  professional: { select: { id: true, name: true, photoUrl: true } },
  service: { select: { id: true, name: true, color: true, duration: true } },
  // Origem: diz se o agendamento veio de uma recorrência e se ela é de um pacote.
  recurringAppointment: { select: { id: true, clientPlanId: true } },
} satisfies Prisma.AppointmentInclude;

export type AppointmentWithRelations = Prisma.AppointmentGetPayload<{
  include: typeof withRelations;
}>;

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
  ): Promise<AppointmentWithRelations> {
    this.ensureIsNotInThePast(dto.startAt);
    await this.ensureParticipants(dto.clientId, dto.professionalId, companyId);

    const endAt = await this.resolveEndAt(
      dto.serviceId,
      dto.startAt,
      companyId,
    );
    const overBooking = await this.resolveOverBooking(
      companyId,
      dto.startAt,
      endAt,
      dto.overBooking,
    );
    await this.ensureSlotIsFree(this.prisma, { ...dto, endAt }, companyId);

    return this.prisma.appointment.create({
      // O valor gravado é o calculado, e não o que veio no payload.
      data: { ...dto, endAt, companyId, overBooking },
      include: withRelations,
    });
  }

  async findAll(
    {
      page,
      limit,
      status,
      professionalId,
      clientId,
      recurringAppointmentId,
      order,
      from,
      to,
    }: FindAppointmentsQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<AppointmentWithRelations>> {
    const where: Prisma.AppointmentWhereInput = {
      companyId,
      status,
      professionalId,
      clientId,
      recurringAppointmentId,
      startAt: from || to ? { gte: from, lt: to } : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        include: withRelations,
        // A agenda é lida em ordem cronológica, e não por data de cadastro; o
        // histórico pode pedir a inversa (desc). O id desempata horários iguais,
        // na mesma direção: sem ele, a ordem entre eles pode mudar de uma página
        // para a outra e repetir ou perder agendamentos.
        orderBy: [{ startAt: order ?? "asc" }, { id: order ?? "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /**
   * Detalhe devolvido pela API, com cliente, profissional e serviço. As
   * validações internas de outros módulos usam o findOne, sem esses JOINs,
   * a não ser que precisem da origem (ex.: o pagamento, para saber se é pacote).
   */
  async findDetail(
    id: string,
    companyId: string,
  ): Promise<AppointmentWithRelations> {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, companyId },
      include: withRelations,
    });

    if (!appointment) {
      throw new NotFoundException("Agendamento não encontrado");
    }

    return appointment;
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
  ): Promise<AppointmentWithRelations> {
    const appointment = await this.findOne(id, companyId);

    await this.ensureNotLockedByPayment(appointment);

    if (appointment.recurringAppointmentId) {
      this.ensureRecurrenceTermsUnchanged(dto);
    }

    this.ensureNotReopened(appointment, dto);

    // A transição para CANCELLED olha o estado atual, antes de qualquer outra
    // mudança do mesmo PATCH (ex.: um novo startAt não "desfaz" o início).
    const cancels = dto.status === AppointmentStatus.CANCELLED;
    if (cancels) {
      this.ensureCanBeCancelled(appointment);
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

    // O encaixe só é reavaliado quando o horário ou o serviço mudam; fora disso,
    // o valor gravado se mantém (o overBooking do payload sozinho não muda nada).
    let overBooking = appointment.overBooking;

    // Um agendamento cancelado não disputa horário nem precisa caber na janela
    // de atendimento; os demais, sim.
    if (status !== AppointmentStatus.CANCELLED) {
      if (dto.serviceId || dto.startAt) {
        overBooking = await this.resolveOverBooking(
          companyId,
          startAt,
          endAt,
          dto.overBooking,
        );
      }

      await this.ensureSlotIsFree(
        this.prisma,
        { clientId, professionalId, startAt, endAt },
        companyId,
        id,
      );
    }

    const data = { ...dto, endAt, overBooking, updatedAt: new Date() };

    if (!cancels) {
      return this.prisma.appointment.update({
        where: { id },
        data,
        include: withRelations,
      });
    }

    /*
     * Cancelar o avulso cancela junto o pagamento ainda PENDING dele (o PAID não
     * muda: não há reembolso), na mesma transação. Exceção à regra de que só o
     * módulo dono grava a tabela: o AppointmentService não pode usar o
     * PaymentService, que já depende dele (dependência circular). É o mesmo
     * recurso usado no cadastro completo de pessoas.
     */
    return this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.appointment.update({
        where: { id },
        data,
        include: withRelations,
      });
      await tx.payment.updateMany({
        where: {
          appointmentId: id,
          status: PaymentStatus.PENDING,
          deletedAt: null,
        },
        data: { status: PaymentStatus.CANCELLED, updatedAt: new Date() },
      });

      return cancelled;
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
    { allowNoShow = false }: { allowNoShow?: boolean } = {},
  ): Promise<Appointment> {
    /*
     * Reposição de pacote: quando o cliente não compareceu (NO_SHOW), a sessão
     * já passou e pode ganhar uma nova data, e volta a SCHEDULED. Só quem chama
     * autoriza (sessões de pacote); nos demais casos o remanejamento é só antes
     * de iniciar.
     */
    const isReplacement =
      allowNoShow && appointment.status === AppointmentStatus.NO_SHOW;
    if (!isReplacement) {
      this.ensureIsUpcoming(appointment, "remanejado");
    }
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
      data: {
        startAt,
        endAt,
        // Sem status no data, o Prisma mantém o atual (o remanejamento comum não o muda).
        status: isReplacement ? AppointmentStatus.SCHEDULED : undefined,
        updatedAt: new Date(),
      },
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
    // A mesma regra do cancelamento do avulso: só antes de iniciar.
    this.ensureCanBeCancelled(appointment);

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

  /**
   * Agendamento concluído com pagamento não sofre mais nenhuma alteração: o
   * pagamento (valor, vencimento, baixa) foi gerado a partir dele, e mudar
   * serviço, cliente, horário ou status o deixaria divergente. Conta o
   * pagamento pendente ou pago; cancelado ou excluído libera a edição. Só
   * consulta quando o agendamento está concluído, para não pesar nos demais.
   */
  private async ensureNotLockedByPayment({ id, status }: Appointment) {
    if (status !== AppointmentStatus.COMPLETED) {
      return;
    }

    const charges = await this.prisma.payment.count({
      where: {
        appointmentId: id,
        deletedAt: null,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.PAID] },
      },
    });
    if (charges > 0) {
      throw new BadRequestException(
        "Agendamento concluído com pagamento não pode ser alterado",
      );
    }
  }

  /**
   * Cancelado é estado final: o cancelamento também cancelou o pagamento
   * pendente, e reabrir o agendamento deixaria a cobrança sem atendimento. Para
   * marcar de novo, cria-se outro agendamento. Repetir CANCELLED cai na regra
   * do cancelamento ("já está cancelado").
   */
  private ensureNotReopened(
    { status }: Appointment,
    dto: UpdateAppointmentDto,
  ) {
    if (
      status === AppointmentStatus.CANCELLED &&
      dto.status !== undefined &&
      dto.status !== AppointmentStatus.CANCELLED
    ) {
      throw new BadRequestException(
        "Agendamento cancelado não pode mudar de status",
      );
    }
  }

  /**
   * Só se cancela o que ainda não começou: status SCHEDULED ou CONFIRMED e
   * início no futuro. O horário é conferido além do status porque o job de
   * status roda a cada 5 minutos: um agendamento que já começou pode ainda
   * estar SCHEDULED ou CONFIRMED. Cancelar de novo também é recusado.
   */
  private ensureCanBeCancelled({ status, startAt }: Appointment) {
    const refusal: Partial<Record<AppointmentStatus, string>> = {
      [AppointmentStatus.CANCELLED]: "O agendamento já está cancelado",
      [AppointmentStatus.COMPLETED]:
        "Agendamento concluído não pode ser cancelado",
      [AppointmentStatus.NO_SHOW]:
        "Agendamento em que o cliente não compareceu não pode ser cancelado",
    };
    const message = refusal[status];
    if (message) {
      throw new BadRequestException(message);
    }

    if (status === AppointmentStatus.IN_PROGRESS || startAt <= new Date()) {
      throw new BadRequestException(
        "Agendamento que já iniciou não pode ser cancelado",
      );
    }
  }

  /**
   * Só se remaneja o que ainda não começou: status SCHEDULED ou CONFIRMED e
   * início no futuro. O horário é conferido além do status porque o job de
   * status roda a cada 5 minutos (mesma razão do cancelamento).
   */
  private ensureIsUpcoming({ status, startAt }: Appointment, action: string) {
    if (!UPCOMING_STATUSES.includes(status)) {
      throw new BadRequestException(
        `Agendamento com status ${status} não pode ser ${action}`,
      );
    }

    if (startAt <= new Date()) {
      throw new BadRequestException(
        `Agendamento que já iniciou não pode ser ${action}`,
      );
    }
  }

  /**
   * Encaixe: um agendamento avulso pode ficar fora do horário de funcionamento
   * (inclusive em dia fechado) se o pedido autorizar com overBooking. Sem a
   * autorização, o horário fora é recusado, para um erro de digitação não virar
   * encaixe sem ninguém perceber. Devolve o valor real a gravar: false quando o
   * horário está dentro, mesmo que a autorização tenha vindo.
   *
   * Recorrência e plano não passam por aqui: continuam exigindo a janela.
   */
  private async resolveOverBooking(
    companyId: string,
    startAt: Date,
    endAt: Date,
    authorized: boolean | undefined,
  ): Promise<boolean> {
    const within = await this.businessHourService.isWithinBusinessHours(
      companyId,
      startAt,
      endAt,
    );
    if (within) {
      return false;
    }

    if (!authorized) {
      throw new BadRequestException(
        "O horário está fora do funcionamento da empresa. Para agendar mesmo assim, envie overBooking: true (encaixe)",
      );
    }

    return true;
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
        `O ${who} já possui um agendamento neste horário`,
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
    timeZone: string,
    note?: string | null,
  ): Promise<Pick<Appointment, "id" | "startAt">[]> {
    for (const { startAt, endAt } of occurrences) {
      try {
        await this.businessHourService.ensureWithinBusinessHours(
          data.companyId,
          startAt,
          endAt,
        );
        await this.ensureSlotIsFree(
          db,
          { ...data, startAt, endAt }, // Pega tudo que existe em data e adiciona startAt e endAt
          data.companyId,
        );
      } catch (error) {
        throw this.withOccurrence(error, startAt, timeZone);
      }
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
   * A criação da recorrência é tudo ou nada, então o erro precisa dizer qual
   * ocorrência o causou. Mantém o tipo do erro (409 de conflito, 400 de horário
   * de funcionamento) e só acrescenta a data e a hora no fuso da empresa.
   */
  private withOccurrence(error: unknown, startAt: Date, timeZone: string) {
    const { day, month, year, hours, minutes } = toZonedParts(
      startAt,
      timeZone,
    );
    const pad = (value: number) => String(value).padStart(2, "0");
    const when = `${pad(day)}/${pad(month)}/${year} às ${pad(hours)}:${pad(minutes)}`;

    if (error instanceof ConflictException) {
      return new ConflictException(`Conflito em ${when}: ${error.message}`);
    }
    if (error instanceof BadRequestException) {
      return new BadRequestException(`Conflito em ${when}: ${error.message}`);
    }

    return error;
  }

  /**
   * Cancela os agendamentos futuros ainda em SCHEDULED ou CONFIRMED que vieram
   * de uma recorrência (a recorrência ou o plano foi cancelado). Preserva o
   * histórico: passados, em andamento, concluídos, no-show e cancelados à mão
   * não são tocados.
   */
  async cancelFutureFromRecurrence(
    db: PrismaClientLike,
    recurringAppointmentId: string,
    from: Date,
  ): Promise<number> {
    const { count } = await db.appointment.updateMany({
      where: {
        recurringAppointmentId,
        status: { in: UPCOMING_STATUSES },
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
