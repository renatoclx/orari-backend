import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import type { Prisma } from "../../../generated/prisma/client";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { PortalCompanyService } from "./portal-company.service";
import {
  SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
} from "./portal-code";
import { normalizePortalPhone } from "./portal-phone";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";

/** Conta do cliente entrada no app (preenchida pelo PortalAuthGuard). */
export interface PortalAccount {
  sessionId: string;
  accountId: string;
}

/** Cadastro do cliente na clínica do endereço, encontrado pela conta. */
export interface PortalClient extends PortalAccount {
  companyId: string;
  peopleId: string;
}

// Mesmo custo das senhas dos usuários da clínica.
const PASSWORD_SALT_ROUNDS = 10;

/**
 * Hash bcrypt de um texto qualquer: quando o telefone não tem conta, a senha é
 * comparada com ele para o login levar o mesmo tempo nos dois casos (como no
 * login da clínica).
 */
const TIMING_PLACEHOLDER_HASH =
  "$2b$10$XmRU9YoHggPHKfhUuaInaOJmQbcemEM0nCmq9lkAKJq6Wd6tLdsnq";

const INVALID_LOGIN = "Telefone ou senha inválidos";

// Código do 403 que o app usa para oferecer "Entrar neste estabelecimento".
export const NOT_A_CLIENT = "NOT_A_CLIENT";

/**
 * Conta do cliente no app: telefone + senha, única no Orari (ver
 * docs/business-rules.md, "Portal do cliente"). A sessão é da conta; em cada
 * clínica o cliente é o cadastro dela (People) ligado à conta.
 */
@Injectable()
export class PortalAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portalCompanyService: PortalCompanyService,
  ) {}

  /**
   * Cria a conta e já abre a sessão. Não liga a conta a nenhum cadastro de
   * clínica: isso só acontece pelo link da clínica ou ao entrar num local.
   */
  async register(dto: RegisterDto, userAgent?: string) {
    const phone = this.phoneOrFail(dto.phone);
    const passwordHash = await this.hashPassword(dto.password);
    try {
      const account = await this.prisma.clientAccount.create({
        data: { phone, name: dto.name, passwordHash },
        select: { id: true },
      });
      return await this.openSession(account.id, userAgent);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          "Já existe uma conta com este telefone. Entre com a senha ou peça o link de acesso ao estabelecimento.",
        );
      }
      throw error;
    }
  }

  async login(dto: LoginDto, userAgent?: string) {
    const phone = normalizePortalPhone(dto.phone);
    const account = phone
      ? await this.prisma.clientAccount.findUnique({
          where: { phone },
          select: { id: true, passwordHash: true },
        })
      : null;
    // A comparação roda mesmo sem conta (ver TIMING_PLACEHOLDER_HASH).
    const matches = await bcrypt.compare(
      dto.password,
      account?.passwordHash ?? TIMING_PLACEHOLDER_HASH,
    );
    if (!account || !matches) throw new UnauthorizedException(INVALID_LOGIN);
    return this.openSession(account.id, userAgent);
  }

  /** Sessão de 90 dias de um aparelho para a conta. O token volta uma vez só. */
  async openSession(
    accountId: string,
    userAgent?: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<{ token: string; expiresAt: Date }> {
    const { token, tokenHash } = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.portalSession.create({
      data: {
        clientAccountId: accountId,
        tokenHash,
        expiresAt,
        userAgent: userAgent?.slice(0, 300),
      },
    });
    return { token, expiresAt };
  }

  /** Sessão válida (não revogada, no prazo). Qualquer falha é 401, sem motivo. */
  async authenticate(token: string): Promise<PortalAccount> {
    const session = await this.prisma.portalSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      select: {
        id: true,
        clientAccountId: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException();
    }
    return { sessionId: session.id, accountId: session.clientAccountId };
  }

  /**
   * O cadastro ativo da conta na clínica do endereço. Sem cadastro, 403
   * NOT_A_CLIENT: o app oferece entrar no estabelecimento.
   */
  async resolveClient(
    account: PortalAccount,
    slug: string,
  ): Promise<PortalClient> {
    const company = await this.portalCompanyService.findBySlug(slug);
    const person = await this.prisma.people.findFirst({
      where: {
        companyId: company.id,
        clientAccountId: account.accountId,
        type: "CLIENT",
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!person) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: NOT_A_CLIENT,
        message: "Você ainda não é cliente deste estabelecimento",
      });
    }
    return { ...account, companyId: company.id, peopleId: person.id };
  }

  /**
   * A conta e os locais dela: os cadastros ativos ligados à conta, só das
   * clínicas com o portal aberto (ligado, ativas e no plano).
   */
  async me(account: PortalAccount) {
    const found = await this.prisma.clientAccount.findUniqueOrThrow({
      where: { id: account.accountId },
      select: {
        id: true,
        name: true,
        phone: true,
        people: {
          where: { deletedAt: null, type: "CLIENT" },
          select: { company: { select: { subdomain: true } } },
        },
      },
    });

    const places = await Promise.all(
      found.people.map(({ company }) =>
        this.portalCompanyService
          .findBySlug(company.subdomain)
          .then((open) => ({
            slug: company.subdomain,
            name: open.name,
            logoUrl: open.logoUrl,
          }))
          // Portal fechado: o local some da lista, sem dizer o motivo.
          .catch(() => null),
      ),
    );

    return {
      account: { id: found.id, name: found.name, phone: found.phone },
      places: places
        .filter((place) => place !== null)
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    };
  }

  /**
   * Troca a senha conferindo a atual. Os outros aparelhos saem; este continua.
   */
  async changePassword(
    account: PortalAccount,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const found = await this.prisma.clientAccount.findUniqueOrThrow({
      where: { id: account.accountId },
      select: { passwordHash: true },
    });
    if (!(await bcrypt.compare(dto.currentPassword, found.passwordHash))) {
      throw new BadRequestException("Senha atual incorreta");
    }
    const passwordHash = await this.hashPassword(dto.newPassword);
    await this.prisma.$transaction([
      this.prisma.clientAccount.update({
        where: { id: account.accountId },
        data: { passwordHash, updatedAt: new Date() },
      }),
      this.prisma.portalSession.updateMany({
        where: {
          clientAccountId: account.accountId,
          revokedAt: null,
          id: { not: account.sessionId },
        },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /** Sai do app neste aparelho (as outras sessões continuam). */
  async logout(account: PortalAccount): Promise<void> {
    await this.prisma.portalSession.update({
      where: { id: account.sessionId },
      data: { revokedAt: new Date() },
    });
  }

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
  }

  phoneOrFail(rawPhone: string): string {
    const phone = normalizePortalPhone(rawPhone);
    if (!phone) {
      throw new BadRequestException(
        "Informe o telefone com DDD (10 ou 11 dígitos)",
      );
    }
    return phone;
  }
}
