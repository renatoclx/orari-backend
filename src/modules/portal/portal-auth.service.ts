import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import { PeopleService } from "../people/people.service";
import { MessageSenderService } from "./message-sender.service";
import { PortalCompanyService } from "./portal-company.service";
import {
  CODE_REQUEST_LIMITS,
  CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  SESSION_TTL_MS,
  VERIFIED_TTL_MS,
  generateCode,
  generateSessionToken,
  hashCode,
  hashSessionToken,
  sameHash,
} from "./portal-code";
import { normalizePortalPhone } from "./portal-phone";
import { CreateSessionDto } from "./dto/create-session.dto";

/** Cliente autenticado no portal (preenchido pelo PortalAuthGuard). */
export interface PortalClient {
  sessionId: string;
  companyId: string;
  peopleId: string;
}

const INVALID_CODE = "Código inválido ou vencido. Peça um novo código.";

/**
 * Entrada do cliente no portal da clínica, sem senha: o telefone é conferido
 * por um código enviado no WhatsApp (ver docs/business-rules.md, "Portal do
 * cliente"). Fluxo: pedir o código → conferir → escolher a pessoa (ou se
 * cadastrar) → sessão de 90 dias por aparelho.
 */
@Injectable()
export class PortalAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly peopleService: PeopleService,
    private readonly messageSender: MessageSenderService,
    private readonly portalCompanyService: PortalCompanyService,
  ) {}

  /**
   * Gera e envia o código. A resposta é a mesma com ou sem cadastro do telefone:
   * o portal não revela quem é cliente da clínica.
   */
  async requestCode(
    slug: string,
    rawPhone: string,
    ip?: string,
  ): Promise<{ expiresAt: Date }> {
    const company = await this.portalCompanyService.findBySlug(slug);
    const phone = this.phoneOrFail(rawPhone);
    await this.ensureRequestLimit(company.id, phone);

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await this.prisma.portalVerification.create({
      data: {
        companyId: company.id,
        phone,
        codeHash: this.hash(company.id, phone, code),
        expiresAt,
        ip,
      },
    });
    await this.messageSender.sendVerificationCode({
      companyId: company.id,
      companyName: company.name,
      phone,
      code,
    });
    return { expiresAt };
  }

  /**
   * Confere o código do pedido mais recente. Certo: devolve a verificação e as
   * pessoas (clientes ativos) da clínica com esse telefone, para o cliente
   * escolher quem é ou se cadastrar.
   */
  async verifyCode(
    slug: string,
    rawPhone: string,
    code: string,
  ): Promise<{
    verificationId: string;
    people: { id: string; name: string }[];
  }> {
    const company = await this.portalCompanyService.findBySlug(slug);
    const phone = this.phoneOrFail(rawPhone);

    const verification = await this.prisma.portalVerification.findFirst({
      where: { companyId: company.id, phone, verifiedAt: null, usedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (
      !verification ||
      verification.expiresAt <= new Date() ||
      verification.attempts >= MAX_CODE_ATTEMPTS
    ) {
      throw new BadRequestException(INVALID_CODE);
    }

    if (!sameHash(verification.codeHash, this.hash(company.id, phone, code))) {
      await this.prisma.portalVerification.update({
        where: { id: verification.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException("Código incorreto");
    }

    await this.prisma.portalVerification.update({
      where: { id: verification.id },
      data: { verifiedAt: new Date() },
    });
    return {
      verificationId: verification.id,
      people: await this.findClientsByPhone(company.id, phone),
    };
  }

  /**
   * Cria a sessão do aparelho para uma das pessoas do telefone ou, com o nome,
   * para um cadastro novo (nome + telefone). Cada verificação vira uma sessão só.
   */
  async createSession(
    slug: string,
    dto: CreateSessionDto,
    userAgent?: string,
  ): Promise<{
    token: string;
    expiresAt: Date;
    person: { id: string; name: string };
  }> {
    const company = await this.portalCompanyService.findBySlug(slug);
    const verification = await this.prisma.portalVerification.findFirst({
      where: { id: dto.verificationId, companyId: company.id },
    });
    if (
      !verification?.verifiedAt ||
      verification.usedAt ||
      verification.verifiedAt.getTime() + VERIFIED_TTL_MS <= Date.now()
    ) {
      throw new BadRequestException(INVALID_CODE);
    }

    const person = await this.resolvePerson(
      company.id,
      verification.phone,
      dto,
    );

    // Marca o uso só se ninguém usou antes: duas chamadas simultâneas não abrem duas sessões.
    const { count } = await this.prisma.portalVerification.updateMany({
      where: { id: verification.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw new BadRequestException(INVALID_CODE);

    const { token, tokenHash } = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.portalSession.create({
      data: {
        companyId: company.id,
        peopleId: person.id,
        tokenHash,
        expiresAt,
        userAgent: userAgent?.slice(0, 300),
      },
    });
    return { token, expiresAt, person };
  }

  /**
   * Sessão válida do portal desta clínica: não revogada, no prazo, cliente ativo.
   * Qualquer falha é 401, sem dizer o motivo.
   */
  async authenticate(slug: string, token: string): Promise<PortalClient> {
    // Clínica inativa, portal desligado ou fora do plano: a sessão também deixa de valer.
    const company = await this.portalCompanyService
      .findBySlug(slug)
      .catch(() => null);
    const session = company
      ? await this.prisma.portalSession.findUnique({
          where: { tokenHash: hashSessionToken(token) },
          include: { people: { select: { deletedAt: true } } },
        })
      : null;
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.companyId !== company?.id ||
      session.people.deletedAt
    ) {
      throw new UnauthorizedException();
    }
    return {
      sessionId: session.id,
      companyId: session.companyId,
      peopleId: session.peopleId,
    };
  }

  async me(client: PortalClient) {
    const [person, company] = await Promise.all([
      this.prisma.people.findUniqueOrThrow({
        where: { id: client.peopleId },
        select: { id: true, name: true },
      }),
      this.prisma.company.findUniqueOrThrow({
        where: { id: client.companyId },
        select: {
          id: true,
          fantasyName: true,
          corporateReason: true,
          logoUrl: true,
          timezone: true,
        },
      }),
    ]);
    return {
      person,
      company: {
        id: company.id,
        name: company.fantasyName ?? company.corporateReason,
        logoUrl: company.logoUrl,
        timezone: company.timezone,
      },
    };
  }

  /** Sai do portal neste aparelho (as outras sessões continuam). */
  async logout(client: PortalClient): Promise<void> {
    await this.prisma.portalSession.update({
      where: { id: client.sessionId },
      data: { revokedAt: new Date() },
    });
  }

  private phoneOrFail(rawPhone: string): string {
    const phone = normalizePortalPhone(rawPhone);
    if (!phone) {
      throw new BadRequestException(
        "Informe o telefone com DDD (10 ou 11 dígitos)",
      );
    }
    return phone;
  }

  private hash(companyId: string, phone: string, code: string): string {
    return hashCode(
      this.config.get<string>("JWT_SECRET")!,
      companyId,
      phone,
      code,
    );
  }

  // Limite por telefone (o limite por IP é do ThrottlerGuard, no controller).
  private async ensureRequestLimit(
    companyId: string,
    phone: string,
  ): Promise<void> {
    for (const { max, windowMs } of CODE_REQUEST_LIMITS) {
      const recent = await this.prisma.portalVerification.count({
        where: {
          companyId,
          phone,
          createdAt: { gte: new Date(Date.now() - windowMs) },
        },
      });
      if (recent >= max) {
        throw new HttpException(
          "Muitos códigos pedidos para este telefone. Aguarde alguns minutos.",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  // Clientes ativos da clínica com esse telefone em algum contato ativo.
  private findClientsByPhone(companyId: string, phone: string) {
    return this.prisma.people.findMany({
      where: {
        companyId,
        type: "CLIENT",
        deletedAt: null,
        contacts: { some: { phone, deletedAt: null } },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  private async resolvePerson(
    companyId: string,
    phone: string,
    dto: CreateSessionDto,
  ): Promise<{ id: string; name: string }> {
    if (dto.personId) {
      const people = await this.findClientsByPhone(companyId, phone);
      const chosen = people.find((person) => person.id === dto.personId);
      // Só uma das pessoas do telefone conferido: ninguém entra como outro cliente.
      if (!chosen)
        throw new BadRequestException(
          "Pessoa não encontrada para este telefone",
        );
      return chosen;
    }
    const created = await this.peopleService.create(
      { name: dto.name!, type: "CLIENT", phone },
      companyId,
    );
    return { id: created.id, name: created.name };
  }
}
