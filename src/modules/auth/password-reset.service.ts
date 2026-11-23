import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuditAction, UserType } from "../../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { MailService } from "../mail/mail.service";
import { UserService } from "../user/user.service";
import { passwordResetEmail } from "./password-reset-email";

/** Quanto o link vale (decisão de 2026-11-23). */
export const RESET_LINK_MINUTES = 60;
/** Pedidos seguidos para o mesmo e-mail: um link por minuto, no máximo. */
const RESEND_COOLDOWN_MS = 60_000;

export const INVALID_LINK_MESSAGE =
  'Este link não vale mais (já foi usado ou passou de 1 hora). Peça um novo em "Esqueci minha senha".';

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/**
 * "Esqueci minha senha" (ver docs/auth.md, "Redefinir a senha"): manda um link
 * por e-mail e troca a senha com ele. O pedido responde sempre igual, exista
 * o e-mail ou não, para não revelar quem tem conta.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger("PasswordReset");

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly mail: MailService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  /** Endereço do sistema para o link: o domínio do app em produção; local, a porta do Next. */
  private appUrl(): string {
    const domain = this.config.get<string>("APP_DOMAIN");
    return domain && !domain.startsWith(":")
      ? `https://${domain}`
      : "http://localhost:3000";
  }

  async request(email: string, now = new Date()): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: email.trim(), mode: "insensitive" },
        deletedAt: null,
      },
      select: { id: true, name: true, email: true },
    });
    if (!user) return;

    // Um link por minuto: clique repetido não lota a caixa da pessoa.
    const recent = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        createdAt: { gt: new Date(now.getTime() - RESEND_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recent) return;

    // O link carrega o token; o banco guarda só o hash.
    const token = randomBytes(32).toString("base64url");
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hash(token),
        expiresAt: new Date(now.getTime() + RESET_LINK_MINUTES * 60_000),
      },
    });

    try {
      await this.mail.send(
        passwordResetEmail({
          to: user.email,
          name: user.name,
          link: `${this.appUrl()}/redefinir-senha?token=${token}`,
          minutes: RESET_LINK_MINUTES,
        }),
      );
    } catch (error) {
      // A resposta continua igual (não revela nada); o erro fica no log, sem o link.
      this.logger.error(
        `Não foi possível enviar o e-mail de redefinição para o usuário ${user.id}: ${String(error)}`,
      );
    }
  }

  /**
   * Troca a senha com o link. Tudo numa transação: a senha nova, as sessões
   * encerradas, os links do usuário marcados como usados e a auditoria.
   * Devolve se a pessoa é profissional (ela entra pelo app, não pelo sistema).
   */
  async reset(
    token: string,
    newPassword: string,
    ip?: string,
    now = new Date(),
  ): Promise<{ professional: boolean }> {
    const link = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hash(token) },
      select: {
        id: true,
        usedAt: true,
        expiresAt: true,
        user: {
          select: { id: true, type: true, companyId: true, deletedAt: true },
        },
      },
    });
    if (!link || link.usedAt || link.expiresAt <= now || link.user.deletedAt) {
      throw new BadRequestException(INVALID_LINK_MESSAGE);
    }
    const { user } = link;

    await this.prisma.$transaction(async (tx) => {
      // Marca primeiro: se dois pedidos chegarem juntos, só um encontra o link livre.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: link.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count === 0) {
        throw new BadRequestException(INVALID_LINK_MESSAGE);
      }
      // Os outros links pedidos antes também deixam de valer.
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      await this.userService.replacePassword(user.id, newPassword, tx);
      await this.auditService.record(
        {
          companyId: user.companyId,
          userId: user.id,
          action: AuditAction.PASSWORD_RESET_COMPLETED,
          entityType: "USER",
          entityId: user.id,
          ip,
        },
        tx,
      );
    });

    return { professional: user.type === UserType.PROFESSIONAL };
  }
}
