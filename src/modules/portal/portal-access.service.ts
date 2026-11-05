import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditAction } from "../../../generated/prisma/enums";
import type { Prisma } from "../../../generated/prisma/client";
import { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { UseAccessLinkDto } from "./dto/access-link.dto";
import { generateSessionToken, hashSessionToken } from "./portal-code";
import { PortalAuthService, type PortalAccount } from "./portal-auth.service";
import { PortalCompanyService } from "./portal-company.service";
import { normalizePortalPhone } from "./portal-phone";

// O link vale por 24 horas e uma vez só.
export const ACCESS_LINK_TTL_MS = 24 * 60 * 60_000;

const INVALID_LINK =
  "Este link de acesso é inválido, já foi usado ou venceu. Peça um novo ao estabelecimento.";

const linkSelect = {
  id: true,
  usedAt: true,
  expiresAt: true,
  company: { select: { subdomain: true } },
  people: {
    select: {
      id: true,
      name: true,
      deletedAt: true,
      clientAccountId: true,
      // Telefone que a clínica tem do cliente (o principal primeiro).
      contacts: {
        where: { deletedAt: null, phone: { not: null } },
        select: { phone: true },
        orderBy: { isPrincipal: "desc" },
      },
    },
  },
} satisfies Prisma.PortalAccessLinkSelect;

type AccessLink = Prisma.PortalAccessLinkGetPayload<{
  select: typeof linkSelect;
}>;

/**
 * Link de acesso que a clínica gera para um cliente (ver docs/business-rules.md,
 * "Portal do cliente"). A prova de identidade é a clínica, que conhece o
 * cliente: é o único caminho que liga a conta do app a um cadastro que já
 * existe, e também serve para criar uma senha nova ("esqueci a senha").
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
        "Ligue o portal na tela Portal do cliente antes de gerar o acesso",
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
      // Caminho no app do cliente; o endereço completo é montado pelo frontend.
      path: `/app/acesso/${token}`,
    };
  }

  /**
   * A clínica confirma o cliente que entrou sozinho pelo app (o limite de
   * agendamentos futuros deixa de valer). Já confirmado: não faz nada.
   */
  async confirm(
    personId: string,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<void> {
    const companyId = currentUser.companyId;
    const person = await this.prisma.people.findFirst({
      where: { id: personId, companyId, type: "CLIENT", deletedAt: null },
      select: { id: true, portalConfirmed: true },
    });
    if (!person) throw new NotFoundException("Cliente não encontrado");
    if (person.portalConfirmed) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.people.update({
        where: { id: person.id },
        data: { portalConfirmed: true },
      });
      await this.auditService.record(
        {
          companyId,
          userId: currentUser.id,
          action: AuditAction.PORTAL_CLIENT_CONFIRMED,
          entityType: "PEOPLE",
          entityId: person.id,
          clientId: person.id,
          ip,
        },
        tx,
      );
    });
  }

  /**
   * O que o app precisa para mostrar a tela do link, sem usá-lo: o local, o
   * nome do cliente, se falta o telefone e se a senha vai criar a conta ou
   * trocar a senha de uma que já existe.
   */
  async check(token: string) {
    const link = await this.findValid(token);
    const place = await this.placeOf(link);
    const phone = clinicPhone(link);
    const hasAccount =
      link.people.clientAccountId !== null ||
      (phone !== undefined &&
        (await this.prisma.clientAccount.count({ where: { phone } })) > 0);
    return {
      place,
      clientName: link.people.name,
      needsPhone: link.people.clientAccountId === null && phone === undefined,
      hasAccount,
    };
  }

  /**
   * Usa o link (uma vez só). Com a conta entrada, liga o cadastro da clínica a
   * ela. Sem a conta, a senha cria a conta ou é a senha nova da conta que já
   * existe; nesse caso, os outros aparelhos dela saem.
   */
  async use(
    dto: UseAccessLinkDto,
    account: PortalAccount | null,
    userAgent?: string,
  ) {
    const link = await this.findValid(dto.token);
    const place = await this.placeOf(link);
    const person = link.people;

    if (account) {
      if (
        person.clientAccountId &&
        person.clientAccountId !== account.accountId
      ) {
        throw new ConflictException(
          "Este cadastro já está ligado a outra conta. Saia do app e abra o link de novo para criar uma senha nova para ela.",
        );
      }
      await this.inTransaction(async (tx) => {
        await this.markUsed(tx, link.id);
        await tx.people.update({
          where: { id: person.id },
          data: { clientAccountId: account.accountId, portalConfirmed: true },
        });
      });
      return { place };
    }

    if (!dto.password) {
      throw new BadRequestException("Crie uma senha para a sua conta");
    }
    const passwordHash = await this.portalAuthService.hashPassword(
      dto.password,
    );
    const fromClinic = clinicPhone(link);

    const session = await this.inTransaction(async (tx) => {
      await this.markUsed(tx, link.id);

      // Cadastro já ligado a uma conta: o link serve para trocar a senha dela.
      if (person.clientAccountId) {
        await this.resetPassword(tx, person.clientAccountId, passwordHash);
        // O link veio da clínica: o cadastro passa a ser confirmado.
        await tx.people.update({
          where: { id: person.id },
          data: { portalConfirmed: true },
        });
        return this.portalAuthService.openSession(
          person.clientAccountId,
          userAgent,
          tx,
        );
      }

      const phone =
        fromClinic ?? this.portalAuthService.phoneOrFail(dto.phone ?? "");
      const existing = await tx.clientAccount.findUnique({
        where: { phone },
        select: { id: true },
      });
      let accountId: string;
      if (existing) {
        // Só junta com a conta do telefone quando o telefone veio da clínica:
        // um número digitado aqui pode ser de outra pessoa.
        if (!fromClinic) {
          throw new ConflictException(
            "Já existe uma conta com este telefone. Entre nela e abra o link de novo.",
          );
        }
        await this.resetPassword(tx, existing.id, passwordHash);
        accountId = existing.id;
      } else {
        const created = await tx.clientAccount.create({
          data: { phone, name: person.name, passwordHash },
          select: { id: true },
        });
        accountId = created.id;
      }
      await tx.people.update({
        where: { id: person.id },
        data: { clientAccountId: accountId, portalConfirmed: true },
      });
      return this.portalAuthService.openSession(accountId, userAgent, tx);
    });

    return { ...session, place };
  }

  private async findValid(token: string): Promise<AccessLink> {
    const link = await this.prisma.portalAccessLink.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      select: linkSelect,
    });
    if (
      !link ||
      link.usedAt ||
      link.expiresAt <= new Date() ||
      link.people.deletedAt
    ) {
      throw new BadRequestException(INVALID_LINK);
    }
    return link;
  }

  // Local do link; com o portal fechado depois de gerado, o link deixa de valer.
  private async placeOf(link: AccessLink) {
    const company = await this.portalCompanyService
      .findBySlug(link.company.subdomain)
      .catch(() => {
        throw new BadRequestException(INVALID_LINK);
      });
    return {
      slug: link.company.subdomain,
      name: company.name,
      logoUrl: company.logoUrl,
    };
  }

  // Uso único, mesmo com dois cliques ao mesmo tempo.
  private async markUsed(tx: Prisma.TransactionClient, linkId: string) {
    const { count } = await tx.portalAccessLink.updateMany({
      where: { id: linkId, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw new BadRequestException(INVALID_LINK);
  }

  private async resetPassword(
    tx: Prisma.TransactionClient,
    accountId: string,
    passwordHash: string,
  ) {
    await tx.clientAccount.update({
      where: { id: accountId },
      data: { passwordHash, updatedAt: new Date() },
    });
    await tx.portalSession.updateMany({
      where: { clientAccountId: accountId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // A conta já tem outro cadastro nesta clínica (índice único parcial): 409.
  private async inTransaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(work);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          "Sua conta já está ligada a outro cadastro neste estabelecimento. Fale com ele.",
        );
      }
      throw error;
    }
  }
}

/** Primeiro telefone válido que a clínica tem do cliente. */
function clinicPhone(link: AccessLink): string | undefined {
  for (const { phone } of link.people.contacts) {
    const normalized = phone ? normalizePortalPhone(phone) : undefined;
    if (normalized) return normalized;
  }
  return undefined;
}
