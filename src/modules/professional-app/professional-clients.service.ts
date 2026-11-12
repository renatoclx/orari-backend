import { Injectable, NotFoundException } from "@nestjs/common";
import { AppointmentStatus, PeopleType } from "../../../generated/prisma/enums";
import type { Prisma } from "../../../generated/prisma/client";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import type { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { PrismaService } from "../../prisma/prisma.service";
import { FindProfessionalClientsQueryDto } from "./dto/find-professional-clients-query.dto";
import { presentOrigin, presentService } from "./professional-app-presenters";
import { ProfessionalLinkService } from "./professional-link.service";

// Os atendimentos mais recentes que a ficha mostra.
const HISTORY_LIMIT = 50;

// Atendimento que ainda vai acontecer.
const UPCOMING_STATUSES = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
];

// Só o que a tela mostra do cliente: sem e-mail, CPF, endereço, nascimento,
// conta do app nem qualquer dado de pagamento.
const clientSelect = {
  id: true,
  name: true,
  photoUrl: true,
  contacts: {
    where: { isPrincipal: true, deletedAt: null },
    select: { phone: true },
    take: 1,
  },
} satisfies Prisma.PeopleSelect;

const historySelect = {
  id: true,
  startAt: true,
  endAt: true,
  status: true,
  note: true,
  overBooking: true,
  classSessionId: true,
  service: {
    select: { id: true, name: true, color: true, duration: true, price: true },
  },
  recurringAppointment: { select: { clientPlanId: true } },
} satisfies Prisma.AppointmentSelect;

/**
 * "Meus clientes" do app do profissional (docs/screens/app-profissional.md).
 * São os clientes ativos com ao menos um agendamento não cancelado com ele
 * (a regra da Carteira de clientes). Só consulta.
 */
@Injectable()
export class ProfessionalClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly link: ProfessionalLinkService,
  ) {}

  /** A carteira dele, em ordem alfabética, com o último e o próximo atendimento. */
  async findAll(
    user: AuthenticatedUser,
    { page, limit, search }: FindProfessionalClientsQueryDto,
    now = new Date(),
  ) {
    const professionalId = await this.link.requireProfessionalId(user);
    const term = search?.trim() ? normalizeForSearch(search) : undefined;
    const where = this.ownClients(user.companyId, professionalId, term);

    const [people, total] = await this.prisma.$transaction([
      this.prisma.people.findMany({
        where,
        select: clientSelect,
        orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.people.count({ where }),
    ]);

    const ids = people.map((person) => person.id);
    const [lasts, nexts] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          companyId: user.companyId,
          professionalId,
          clientId: { in: ids },
          status: AppointmentStatus.COMPLETED,
          startAt: { lte: now },
        },
        // O primeiro de cada cliente, do mais recente.
        orderBy: { startAt: "desc" },
        distinct: ["clientId"],
        select: {
          clientId: true,
          startAt: true,
          service: { select: { name: true } },
        },
      }),
      this.prisma.appointment.findMany({
        where: {
          companyId: user.companyId,
          professionalId,
          clientId: { in: ids },
          status: { in: UPCOMING_STATUSES },
          startAt: { gte: now },
        },
        orderBy: { startAt: "asc" },
        distinct: ["clientId"],
        select: { clientId: true, startAt: true },
      }),
    ]);
    const lastBy = new Map(lasts.map((row) => [row.clientId, row]));
    const nextBy = new Map(nexts.map((row) => [row.clientId, row.startAt]));

    const result: PaginatedResult<ReturnType<typeof presentClient> & Summary> =
      {
        items: people.map((person) => ({
          ...presentClient(person),
          lastCompleted: lastBy.has(person.id)
            ? {
                startAt: lastBy.get(person.id)!.startAt,
                serviceName: lastBy.get(person.id)!.service.name,
              }
            : null,
          nextAt: nextBy.get(person.id) ?? null,
        })),
        total,
        page,
        limit,
      };
    return result;
  }

  /**
   * A ficha de um cliente dele: contato, último e próximo atendimento e o
   * histórico dos atendimentos **dele** com esse cliente (os mais recentes).
   * Cliente que não é da carteira dele responde 404, como o inexistente.
   */
  async findOne(user: AuthenticatedUser, clientId: string, now = new Date()) {
    const professionalId = await this.link.requireProfessionalId(user);
    const person = await this.prisma.people.findFirst({
      where: {
        ...this.ownClients(user.companyId, professionalId),
        id: clientId,
      },
      select: clientSelect,
    });
    if (!person) {
      throw new NotFoundException("Cliente não encontrado");
    }

    const base = { companyId: user.companyId, professionalId, clientId };
    const [history, last, next] = await Promise.all([
      this.prisma.appointment.findMany({
        where: base,
        orderBy: [{ startAt: "desc" }, { id: "desc" }],
        take: HISTORY_LIMIT,
        select: historySelect,
      }),
      this.prisma.appointment.findFirst({
        where: {
          ...base,
          status: AppointmentStatus.COMPLETED,
          startAt: { lte: now },
        },
        orderBy: { startAt: "desc" },
        select: { startAt: true, service: { select: { name: true } } },
      }),
      this.prisma.appointment.findFirst({
        where: {
          ...base,
          status: { in: UPCOMING_STATUSES },
          startAt: { gte: now },
        },
        orderBy: { startAt: "asc" },
        select: { startAt: true },
      }),
    ]);

    return {
      ...presentClient(person),
      lastCompleted: last
        ? { startAt: last.startAt, serviceName: last.service.name }
        : null,
      nextAt: next?.startAt ?? null,
      history: history.map(
        ({ recurringAppointment, service, classSessionId, ...item }) => ({
          ...item,
          service: presentService(service),
          recurrence: presentOrigin(recurringAppointment),
          // Atendimento de turma: o histórico o marca, sem listar os colegas.
          inClass: classSessionId !== null,
        }),
      ),
    };
  }

  // Cliente ativo da empresa com ao menos um agendamento não cancelado com o
  // profissional (e, na busca, com o termo já normalizado no nome).
  private ownClients(
    companyId: string,
    professionalId: string,
    term?: string,
  ): Prisma.PeopleWhereInput {
    return {
      companyId,
      type: PeopleType.CLIENT,
      deletedAt: null,
      ...(term && { normalizedName: { contains: term } }),
      appointmentsAsClient: {
        some: {
          professionalId,
          status: { not: AppointmentStatus.CANCELLED },
        },
      },
    };
  }
}

type Summary = {
  lastCompleted: { startAt: Date; serviceName: string } | null;
  nextAt: Date | null;
};

function presentClient(person: {
  id: string;
  name: string;
  photoUrl: string | null;
  contacts: { phone: string | null }[];
}) {
  return {
    id: person.id,
    name: person.name,
    photoUrl: person.photoUrl,
    // O celular do contato principal; nulo se não houver.
    phone: person.contacts[0]?.phone ?? null,
  };
}
