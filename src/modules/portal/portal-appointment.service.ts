import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Appointment } from "../../../generated/prisma/client";
import {
  AppointmentSource,
  AppointmentStatus,
} from "../../../generated/prisma/enums";
import { toZonedParts } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { AppointmentService } from "../appointment/appointment.service";
import type { PortalClient } from "./portal-auth.service";
import { PortalAvailabilityService } from "./portal-availability.service";
import type { PortalCompany } from "./portal-company.service";
import { BookAppointmentDto } from "./dto/book-appointment.dto";

// Quantos atendimentos passados o cliente vê no histórico do portal.
const HISTORY_SIZE = 20;

// Cliente que entrou sozinho e ainda não foi confirmado pela clínica: no máximo
// esta quantidade de agendamentos futuros, para limitar marcações falsas.
export const UNCONFIRMED_UPCOMING_LIMIT = 2;
export const UNCONFIRMED_LIMIT = "UNCONFIRMED_LIMIT";

type Kind = "SINGLE" | "RECURRENCE" | "PLAN" | "CLASS";

const listSelect = {
  id: true,
  startAt: true,
  endAt: true,
  status: true,
  source: true,
  recurringAppointmentId: true,
  classSessionId: true,
  recurringAppointment: { select: { clientPlanId: true } },
  service: { select: { name: true, duration: true } },
  professional: { select: { name: true } },
} as const;

/**
 * Agendamentos do cliente pelo portal. Pelo portal só se marcam e se cancelam
 * agendamentos avulsos; recorrência, pacote e turma aparecem na lista, mas
 * continuam com a clínica (ver docs/business-rules/portal-do-cliente.md, "Portal do cliente").
 */
@Injectable()
export class PortalAppointmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentService: AppointmentService,
    private readonly portalAvailabilityService: PortalAvailabilityService,
  ) {}

  /** Próximos (não cancelados) e os últimos atendimentos passados. */
  async list(company: PortalCompany, client: PortalClient, now = new Date()) {
    const where = { companyId: company.id, clientId: client.peopleId };
    const [upcoming, past] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          ...where,
          startAt: { gte: now },
          status: { not: AppointmentStatus.CANCELLED },
        },
        select: listSelect,
        orderBy: { startAt: "asc" },
      }),
      this.prisma.appointment.findMany({
        where: { ...where, startAt: { lt: now } },
        select: listSelect,
        orderBy: { startAt: "desc" },
        take: HISTORY_SIZE,
      }),
    ]);
    const view = (item: (typeof upcoming)[number]) =>
      this.toView(item, company, now);
    return { upcoming: upcoming.map(view), past: past.map(view) };
  }

  /**
   * Agenda um avulso. O horário precisa ser um dos livres agora (mesma regra
   * da lista de horários); a gravação é a da clínica, com a trava por
   * profissional, e guarda a origem PORTAL.
   */
  async book(
    company: PortalCompany,
    client: PortalClient,
    dto: BookAppointmentDto,
  ) {
    await this.ensureUnconfirmedLimit(client);

    const { year, month, day } = toZonedParts(dto.startAt, company.timezone);
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const slots = await this.portalAvailabilityService.findSlots(
      company,
      dto.serviceId,
      dto.professionalId,
      date,
    );
    if (!slots.some((slot) => slot.startAt === dto.startAt.toISOString())) {
      throw new ConflictException(
        "Este horário não está mais disponível. Escolha outro.",
      );
    }

    const created = await this.appointmentService.create(
      {
        clientId: client.peopleId,
        professionalId: dto.professionalId,
        serviceId: dto.serviceId,
        startAt: dto.startAt,
      },
      company.id,
      AppointmentSource.PORTAL,
    );
    const item = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: created.id },
      select: listSelect,
    });
    return this.toView(item, company, new Date());
  }

  /**
   * Cancela um avulso do próprio cliente, dentro do prazo da clínica. As demais
   * regras (já iniciado, concluído, pagamento) são as do cancelamento da clínica.
   */
  async cancel(company: PortalCompany, client: PortalClient, id: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, companyId: company.id, clientId: client.peopleId },
    });
    if (!appointment) throw new NotFoundException("Agendamento não encontrado");

    if (this.kindOf(appointment) !== "SINGLE") {
      throw new BadRequestException(
        "Aulas de recorrência, pacote ou turma são canceladas pela clínica",
      );
    }
    if (!this.withinCancelDeadline(appointment.startAt, company, new Date())) {
      throw new BadRequestException(
        `O cancelamento pelo portal vai até ${company.rules.cancelUntilHours} horas antes. Fale com a clínica.`,
      );
    }

    // O próprio cliente cancelou: sem aviso para ele.
    await this.appointmentService.update(
      id,
      { status: AppointmentStatus.CANCELLED },
      company.id,
      "client",
    );
  }

  /**
   * Cliente não confirmado já com o limite de agendamentos futuros: 403
   * UNCONFIRMED_LIMIT. Conta os futuros não cancelados, de qualquer origem.
   */
  private async ensureUnconfirmedLimit(client: PortalClient) {
    const person = await this.prisma.people.findUniqueOrThrow({
      where: { id: client.peopleId },
      select: { portalConfirmed: true },
    });
    if (person.portalConfirmed) return;

    const upcoming = await this.prisma.appointment.count({
      where: {
        companyId: client.companyId,
        clientId: client.peopleId,
        startAt: { gte: new Date() },
        status: { not: AppointmentStatus.CANCELLED },
      },
    });
    if (upcoming >= UNCONFIRMED_UPCOMING_LIMIT) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: UNCONFIRMED_LIMIT,
        message: `Até o estabelecimento confirmar o seu cadastro, você pode ter no máximo ${UNCONFIRMED_UPCOMING_LIMIT} agendamentos futuros.`,
      });
    }
  }

  private toView(
    item: {
      id: string;
      startAt: Date;
      endAt: Date;
      status: AppointmentStatus;
      source: AppointmentSource;
      recurringAppointmentId: string | null;
      classSessionId: string | null;
      recurringAppointment: { clientPlanId: string | null } | null;
      service: { name: string; duration: number };
      professional: { name: string };
    },
    company: PortalCompany,
    now: Date,
  ) {
    const kind = this.kindOf(item);
    const open =
      item.status === AppointmentStatus.SCHEDULED ||
      item.status === AppointmentStatus.CONFIRMED;
    return {
      id: item.id,
      startAt: item.startAt,
      endAt: item.endAt,
      status: item.status,
      source: item.source,
      kind,
      service: item.service,
      professional: item.professional,
      canCancel:
        kind === "SINGLE" &&
        open &&
        this.withinCancelDeadline(item.startAt, company, now),
    };
  }

  private kindOf(
    item: Pick<Appointment, "recurringAppointmentId" | "classSessionId"> & {
      recurringAppointment?: { clientPlanId: string | null } | null;
    },
  ): Kind {
    if (item.classSessionId) return "CLASS";
    if (item.recurringAppointment?.clientPlanId) return "PLAN";
    if (item.recurringAppointmentId) return "RECURRENCE";
    return "SINGLE";
  }

  // Até `cancelUntilHours` antes do início.
  private withinCancelDeadline(
    startAt: Date,
    company: PortalCompany,
    now: Date,
  ) {
    return (
      startAt.getTime() - now.getTime() >=
      company.rules.cancelUntilHours * 60 * 60_000
    );
  }
}
