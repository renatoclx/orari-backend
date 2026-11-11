import { Injectable } from "@nestjs/common";
import type { Prisma } from "../../../generated/prisma/client";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyAccessService } from "../company-access/company-access.service";

// Quantos estabelecimentos a busca devolve, no máximo.
export const DIRECTORY_LIMIT = 20;

// Endereço principal da própria empresa (sem pessoa), só a cidade.
const companyCity = {
  where: { peopleId: null, isPrincipal: true, deletedAt: null },
  select: {
    city: { select: { name: true, state: { select: { acronym: true } } } },
  },
  take: 1,
} satisfies Prisma.Company$addressesArgs;

type CityRow = Prisma.AddressGetPayload<typeof companyCity>;

/**
 * Busca de estabelecimentos do app (ver docs/business-rules/portal-do-cliente.md, "Portal do
 * cliente"). Só aparecem as clínicas ativas, com o portal ligado, no plano e
 * que escolheram aparecer na busca (com o segmento).
 */
@Injectable()
export class PortalDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyAccessService: CompanyAccessService,
  ) {}

  /**
   * Pelo nome fantasia ou pela razão social, sem acentos e sem diferença de
   * maiúsculas. Ordem alfabética, no máximo DIRECTORY_LIMIT.
   */
  async search(q: string) {
    const term = normalizeForSearch(q);
    // O filtro do nome é feito aqui, depois do banco: o nome da empresa não tem
    // coluna normalizada, e as clínicas que aparecem na busca ainda são poucas.
    const companies = await this.prisma.company.findMany({
      where: {
        isActive: true,
        portalSettings: { enabled: true, listed: true, segment: { not: null } },
      },
      select: {
        id: true,
        subdomain: true,
        fantasyName: true,
        corporateReason: true,
        logoUrl: true,
        portalSettings: { select: { segment: true } },
        addresses: companyCity,
      },
    });

    const matches = companies
      .filter((company) =>
        [company.fantasyName, company.corporateReason].some(
          (name) => name && normalizeForSearch(name).includes(term),
        ),
      )
      .map((company) => ({
        id: company.id,
        slug: company.subdomain,
        name: company.fantasyName ?? company.corporateReason,
        logoUrl: company.logoUrl,
        segment: company.portalSettings!.segment!,
        city: cityLabel(company.addresses[0]),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    // Fora do plano não aparece (como no portal, que responde 404).
    const allowed = await Promise.all(
      matches.map((company) =>
        this.companyAccessService.can(company.id, "client-portal", "view"),
      ),
    );
    return (
      matches
        .filter((_, index) => allowed[index])
        .slice(0, DIRECTORY_LIMIT)
        // O id interno da clínica não vai para o app.
        .map(({ slug, name, logoUrl, segment, city }) => ({
          slug,
          name,
          logoUrl,
          segment,
          city,
        }))
    );
  }

  /** Cidade do endereço principal da empresa ("Belo Horizonte - MG"), se houver. */
  async cityOf(companyId: string): Promise<string | null> {
    const address = await this.prisma.address.findFirst({
      where: { ...companyCity.where, companyId },
      select: companyCity.select,
    });
    return cityLabel(address ?? undefined);
  }
}

function cityLabel(address: CityRow | undefined): string | null {
  return address
    ? `${address.city.name} - ${address.city.state.acronym}`
    : null;
}
