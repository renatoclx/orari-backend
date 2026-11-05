import { Injectable } from "@nestjs/common";
import {
  AddressType,
  ContactType,
  PeopleType,
} from "../../../generated/prisma/enums";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { formatTimeOfDay } from "../../common/time/time-of-day";
import { toZonedParts } from "../../common/time/time-zone";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { PortalAppointmentService } from "./portal-appointment.service";
import type { PortalAccount } from "./portal-auth.service";
import {
  PortalCompanyService,
  type PortalCompany,
} from "./portal-company.service";

// Quantos atendimentos passados aparecem na lista de todos os locais.
const HISTORY_SIZE = 20;

/**
 * Os estabelecimentos da conta do cliente: entrar sozinho num novo e ver os
 * agendamentos de todos (ver docs/business-rules.md, "Portal do cliente").
 */
@Injectable()
export class PortalPlaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portalCompanyService: PortalCompanyService,
    private readonly portalAppointmentService: PortalAppointmentService,
  ) {}

  /**
   * Entra sozinho num estabelecimento: cria um cadastro NOVO de cliente, com
   * Meus dados da conta, marcado como não confirmado. Nunca junta com um
   * cadastro que já existe na clínica, mesmo com o telefone igual: o telefone
   * da conta não foi conferido. Já sendo cliente, não faz nada.
   */
  async join(account: PortalAccount, slug: string) {
    const company = await this.portalCompanyService.findBySlug(slug);
    const place = toPlace(slug, company);
    if (await this.findClient(account.accountId, company.id)) {
      return { place, joined: false };
    }

    // O cadastro novo nasce com Meus dados da conta (a foto vai quando o
    // cliente trocar a foto no app).
    const profile = await this.prisma.clientAccount.findUniqueOrThrow({
      where: { id: account.accountId },
      select: {
        name: true,
        phone: true,
        email: true,
        document: true,
        birthDate: true,
        profession: true,
        addressCep: true,
        addressStreet: true,
        addressNumber: true,
        addressComplement: true,
        addressNeighborhood: true,
        addressCityId: true,
      },
    });
    // O CPF só vai se não estiver em outro cadastro ativo da clínica (lá ele é único).
    const documentTaken =
      profile.document !== null &&
      (await this.prisma.people.count({
        where: {
          companyId: company.id,
          document: profile.document,
          deletedAt: null,
        },
      })) > 0;
    try {
      await this.prisma.people.create({
        data: {
          name: profile.name,
          normalizedName: normalizeForSearch(profile.name),
          type: PeopleType.CLIENT,
          companyId: company.id,
          clientAccountId: account.accountId,
          portalConfirmed: false,
          document: documentTaken ? null : profile.document,
          birthDate: profile.birthDate,
          profession: profile.profession,
          // Telefone e e-mail da conta viram o contato principal.
          contacts: {
            create: {
              type: ContactType.MAIN,
              phone: profile.phone,
              email: profile.email,
              isPrincipal: true,
            },
          },
          ...(profile.addressCep &&
            profile.addressStreet &&
            profile.addressNumber &&
            profile.addressCityId && {
              addresses: {
                create: {
                  type: AddressType.MAIN,
                  cep: profile.addressCep,
                  street: profile.addressStreet,
                  number: profile.addressNumber,
                  complement: profile.addressComplement,
                  neighborhood: profile.addressNeighborhood,
                  cityId: profile.addressCityId,
                  isPrincipal: true,
                },
              },
            }),
        },
        select: { id: true },
      });
    } catch (error) {
      // Dois toques ao mesmo tempo: o índice único deixa um só cadastro.
      if (isUniqueConstraintViolation(error)) return { place, joined: false };
      throw error;
    }
    return { place, joined: true };
  }

  /**
   * Agendamentos da conta em todos os estabelecimentos de portal aberto: os
   * próximos (do mais perto ao mais longe) e os últimos passados. Cada item diz
   * de qual local é.
   */
  async appointments(account: PortalAccount, now = new Date()) {
    const people = await this.prisma.people.findMany({
      where: {
        clientAccountId: account.accountId,
        type: PeopleType.CLIENT,
        deletedAt: null,
      },
      select: {
        id: true,
        companyId: true,
        company: { select: { subdomain: true } },
      },
    });

    const lists = await Promise.all(
      people.map(async (person) => {
        const company = await this.portalCompanyService
          .findBySlug(person.company.subdomain)
          // Portal fechado: os agendamentos desse local não aparecem.
          .catch(() => null);
        if (!company) return null;
        const place = toPlace(person.company.subdomain, company);
        const list = await this.portalAppointmentService.list(
          company,
          { ...account, companyId: company.id, peopleId: person.id },
          now,
        );
        const withPlace = <T>(item: T) => ({ ...item, place });
        return {
          upcoming: list.upcoming.map(withPlace),
          past: list.past.map(withPlace),
        };
      }),
    );

    const open = lists.filter((list) => list !== null);
    const time = (item: { startAt: Date }) => item.startAt.getTime();
    return {
      upcoming: open
        .flatMap((list) => list.upcoming)
        .sort((a, b) => time(a) - time(b)),
      past: open
        .flatMap((list) => list.past)
        .sort((a, b) => time(b) - time(a))
        .slice(0, HISTORY_SIZE),
    };
  }

  /**
   * Pacotes contratados em todos os estabelecimentos de portal aberto, só para
   * ver: plano, período e situação (sem valores). Ativos primeiro, depois os
   * mais recentes.
   */
  async plans(account: PortalAccount) {
    const places = await this.openPlaces(account.accountId);
    const lists = await Promise.all(
      places.map(async ({ person, place, company }) => {
        const today = dateOnly(company.timezone);
        const rows = await this.prisma.clientPlan.findMany({
          where: { clientId: person.id, companyId: company.id },
          select: {
            id: true,
            startDate: true,
            endDate: true,
            cancelledAt: true,
            plan: { select: { name: true } },
          },
          orderBy: { startDate: "desc" },
        });
        return rows.map((row) => ({
          id: row.id,
          planName: row.plan.name,
          startDate: isoDate(row.startDate),
          endDate: isoDate(row.endDate),
          // Mesma regra da clínica: cancelada; encerrada (data final passou); ativa.
          status: row.cancelledAt
            ? ("cancelled" as const)
            : row.endDate < today
              ? ("finished" as const)
              : ("active" as const),
          place,
        }));
      }),
    );
    return lists
      .flat()
      .sort(
        (a, b) =>
          Number(b.status === "active") - Number(a.status === "active") ||
          b.startDate.localeCompare(a.startDate),
      );
  }

  /**
   * Recorrências em vigor (horários fixos, de pacote e de turma) em todos os
   * estabelecimentos de portal aberto, só para ver: serviço, profissional, dias
   * e horários, período. Quem marca e muda é a clínica.
   */
  async recurrences(account: PortalAccount) {
    const places = await this.openPlaces(account.accountId);
    const lists = await Promise.all(
      places.map(async ({ person, place, company }) => {
        const today = dateOnly(company.timezone);
        const rows = await this.prisma.recurringAppointment.findMany({
          where: {
            clientId: person.id,
            companyId: company.id,
            isActive: true,
            classLeftAt: null,
            OR: [{ endDate: null }, { endDate: { gte: today } }],
          },
          select: {
            id: true,
            startDate: true,
            endDate: true,
            clientPlanId: true,
            classGroupId: true,
            service: { select: { name: true } },
            professional: { select: { name: true } },
            days: {
              select: { weekDay: true, startTime: true, endTime: true },
              orderBy: { startTime: "asc" },
            },
          },
          orderBy: { startDate: "asc" },
        });
        return rows.map((row) => ({
          id: row.id,
          kind: row.classGroupId
            ? ("CLASS" as const)
            : row.clientPlanId
              ? ("PLAN" as const)
              : ("RECURRENCE" as const),
          service: row.service,
          professional: row.professional,
          days: row.days.map((day) => ({
            weekDay: day.weekDay,
            startTime: formatTimeOfDay(day.startTime),
            endTime: formatTimeOfDay(day.endTime),
          })),
          startDate: isoDate(row.startDate),
          endDate: row.endDate ? isoDate(row.endDate) : null,
          place,
        }));
      }),
    );
    return lists.flat();
  }

  // Cadastros ativos da conta, só nas clínicas com o portal aberto.
  private async openPlaces(accountId: string) {
    const people = await this.prisma.people.findMany({
      where: {
        clientAccountId: accountId,
        type: PeopleType.CLIENT,
        deletedAt: null,
      },
      select: { id: true, company: { select: { subdomain: true } } },
    });
    const found = await Promise.all(
      people.map(async (person) => {
        const company = await this.portalCompanyService
          .findBySlug(person.company.subdomain)
          .catch(() => null);
        return company
          ? {
              person,
              company,
              place: toPlace(person.company.subdomain, company),
            }
          : null;
      }),
    );
    return found.filter((item) => item !== null);
  }

  private findClient(accountId: string, companyId: string) {
    return this.prisma.people.findFirst({
      where: {
        companyId,
        clientAccountId: accountId,
        type: PeopleType.CLIENT,
        deletedAt: null,
      },
      select: { id: true },
    });
  }
}

// Hoje no relógio da clínica, como data pura (as datas de plano e recorrência são DATE).
function dateOnly(timeZone: string): Date {
  const { year, month, day } = toZonedParts(new Date(), timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

// Data pura como "aaaa-mm-dd".
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// O fuso vai junto: o app mostra cada horário no relógio da clínica.
function toPlace(slug: string, company: PortalCompany) {
  return {
    slug,
    name: company.name,
    logoUrl: company.logoUrl,
    timezone: company.timezone,
  };
}
