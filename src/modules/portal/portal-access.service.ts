import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditAction } from "../../../generated/prisma/enums";
import { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { generateSessionToken, hashSessionToken } from "./portal-code";
import { PortalAuthService } from "./portal-auth.service";
import { PortalCompanyService } from "./portal-company.service";

// O link vale por 24 horas e uma vez só.
export const ACCESS_LINK_TTL_MS = 24 * 60 * 60_000;

const INVALID_LINK =
  "Este link de acesso é inválido, já foi usado ou venceu. Peça um novo à clínica.";

/**
 * Acesso ao portal pelo link que a clínica gera para um cliente (ver
 * docs/business-rules.md, "Portal do cliente"). A prova de identidade é a
 * clínica, que conhece o cliente: não depende do envio de código pelo WhatsApp.
 */
@Injectable()
export class PortalAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly portalAuthService: PortalAuthService,
    private readonly portalCompanyService: PortalCompanyService,
  ) {}

  /**
   * Gera o link para um cliente ativo da empresa do usuário. Um link novo
   * invalida o anterior ainda não usado. O token volta uma única vez.
   */
  async createLink(
    personId: string,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<{ token: string; expiresAt: Date; path: string }> {
    const companyId = currentUser.companyId;
    const [person, company] = await Promise.all([
      this.prisma.people.findFirst({
        where: { id: personId, companyId, type: "CLIENT", deletedAt: null },
        select: { id: true },
      }),
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { subdomain: true },
      }),
    ]);
    if (!person) throw new NotFoundException("Cliente não encontrado");

    // Sem portal ligado, o link não abriria nada: avisa em vez de gerar.
    await this.portalCompanyService.findBySlug(company.subdomain).catch(() => {
      throw new ConflictException(
        "Ligue o portal do cliente em Configurações antes de gerar o acesso",
      );
    });

    const { token, tokenHash } = generateSessionToken();
    const expiresAt = new Date(Date.now() + ACCESS_LINK_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.portalAccessLink.updateMany({
        where: { peopleId: person.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.portalAccessLink.create({
        data: { companyId, peopleId: person.id, tokenHash, expiresAt },
      });
      await this.auditService.record(
        {
          companyId,
          userId: currentUser.id,
          action: AuditAction.PORTAL_ACCESS_LINK_CREATED,
          entityType: "PEOPLE",
          entityId: person.id,
          clientId: person.id,
          ip,
        },
        tx,
      );
    });

    return {
      token,
      expiresAt,
      // Caminho do portal no frontend; o endereço completo é montado por ele.
      path: `/p/${company.subdomain}/acesso/${token}`,
    };
  }

  /** Troca o link por uma sessão de 90 dias neste aparelho. */
  async exchange(slug: string, token: string, userAgent?: string) {
    const company = await this.portalCompanyService.findBySlug(slug);
    const link = await this.prisma.portalAccessLink.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: {
        people: { select: { id: true, name: true, deletedAt: true } },
      },
    });
    if (
      !link ||
      link.companyId !== company.id ||
      link.usedAt ||
      link.expiresAt <= new Date() ||
      link.people.deletedAt
    ) {
      throw new BadRequestException(INVALID_LINK);
    }

    // Uso único, mesmo com dois cliques ao mesmo tempo.
    const { count } = await this.prisma.portalAccessLink.updateMany({
      where: { id: link.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw new BadRequestException(INVALID_LINK);

    return this.portalAuthService.openSession(
      company.id,
      { id: link.people.id, name: link.people.name },
      userAgent,
    );
  }
}
