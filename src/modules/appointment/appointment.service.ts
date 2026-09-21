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

// Aceita tanto o PrismaService quanto o cliente de uma transação em andamento.
type PrismaClientLike = Pick<PrismaService, "appointment">;

/**
 * Agendamentos pertencem à empresa do usuário autenticado; os de outras empresas
 * se comportam como inexistentes (404).
 *
 * Não existe exclusão (ver domain.md): o ciclo de vida é controlado pelo status,
 * e cancelar é mudar o status para CANCELLED.
 */
@Injectable()
export class AppointmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly peopleService: PeopleService,
    private readonly serviceService: ServiceService,
    private readonly businessHourService: BusinessHourService,
  ) {}

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
    ignoreId?: string,
    occurrenceLabel?: string,
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
  ): Promise<number> {
    for (const { startAt, endAt } of occurrences) {
      await this.businessHourService.ensureWithinBusinessHours(
        data.companyId,
        startAt,
        endAt,
      );
      await this.ensureSlotIsFree(
        db,
        { ...data, startAt, endAt },
        data.companyId,
        undefined,
        startAt.toISOString(),
      );
    }

    const created = await db.appointment.createMany({
      data: occurrences.map((occurrence) => ({
        ...data,
        ...occurrence,
        note: note ?? null,
      })),
    });

    return created.count;
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
}
