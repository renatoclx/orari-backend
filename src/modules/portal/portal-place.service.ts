import { Injectable } from "@nestjs/common";
import { ContactType, PeopleType } from "../../../generated/prisma/enums";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
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
   * Entra sozinho num estabelecimento: cria um cadastro NOVO de cliente, com o
   * nome e o telefone da conta, marcado como não confirmado. Nunca junta com um
   * cadastro que já existe na clínica, mesmo com o telefone igual: o telefone
   * da conta não foi conferido. Já sendo cliente, não faz nada.
   */
  async join(account: PortalAccount, slug: string) {
    const company = await this.portalCompanyService.findBySlug(slug);
    const place = toPlace(slug, company);
    if (await this.findClient(account.accountId, company.id)) {
      return { place, joined: false };
    }

    const { name, phone } = await this.prisma.clientAccount.findUniqueOrThrow({
      where: { id: account.accountId },
      select: { name: true, phone: true },
    });
    try {
      await this.prisma.people.create({
        data: {
          name,
          normalizedName: normalizeForSearch(name),
          type: PeopleType.CLIENT,
          companyId: company.id,
          clientAccountId: account.accountId,
          portalConfirmed: false,
          // O telefone da conta vira o contato principal, como no cadastro rápido.
          contacts: {
            create: { type: ContactType.MAIN, phone, isPrincipal: true },
          },
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

// O fuso vai junto: o app mostra cada horário no relógio da clínica.
function toPlace(slug: string, company: PortalCompany) {
  return {
    slug,
    name: company.name,
    logoUrl: company.logoUrl,
    timezone: company.timezone,
  };
}
