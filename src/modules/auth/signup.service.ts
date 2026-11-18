import { ConflictException, Injectable } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import {
  AuditAction,
  BillingCycle,
  ContactType,
  UserType,
} from "../../../generated/prisma/enums";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { localDateOf } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { AuditService } from "../audit/audit.service";
import {
  PLAN_LIMITS,
  PLAN_MONTHLY_PRICE,
  planFeatureAccessRows,
} from "../company-access/plan-templates";
import { DEFAULT_EXPENSE_CATEGORIES } from "../expense-category/expense-category.service";
import { addDays } from "../subscription/subscription-status";
import { AuthService, type AuthTokens } from "./auth.service";
import { SignupDto } from "./dto/signup.dto";

/** Dias do teste grátis, contando o dia do cadastro. */
export const TRIAL_DAYS = 7;
/** Fuso da empresa nova (ela muda depois em Configurações, se precisar). */
const DEFAULT_TIME_ZONE = "America/Sao_Paulo";
const PASSWORD_SALT_ROUNDS = 10;

/**
 * "Studio Aurora & Cia." → "studio-aurora-cia" (letras, números e hífens, como
 * o subdomínio exige); vazio vira "empresa".
 */
export function slugify(name: string): string {
  const slug = normalizeForSearch(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "empresa";
}

/**
 * Cadastro sozinho (ver docs/business-rules/empresa-e-acesso.md, "Cadastro
 * sozinho"): a empresa, os acessos e limites do plano escolhido, a assinatura
 * em teste por 7 dias, o contato e o administrador, numa transação. Depois,
 * entra como no login (devolve os tokens).
 */
@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
  ) {}

  async signup(dto: SignupDto, now = new Date()): Promise<AuthTokens> {
    await this.ensureFree(dto);
    const subdomain = await this.freeSubdomain(slugify(dto.companyName));
    const today = localDateOf(now, DEFAULT_TIME_ZONE);
    const password = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);

    try {
      await this.prisma.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: {
            corporateReason: dto.companyName,
            document: dto.document,
            subdomain,
            timezone: DEFAULT_TIME_ZONE,
            featureAccess: { create: planFeatureAccessRows(dto.plan) },
            limit: { create: PLAN_LIMITS[dto.plan] },
            // Categorias de despesa iniciais (as mesmas da empresa criada pelo SUPER_ADMIN).
            expenseCategories: {
              create: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
                name,
                normalizedName: normalizeForSearch(name),
              })),
            },
            contacts: {
              create: {
                type: ContactType.MAIN,
                phone: dto.phone,
                email: dto.email,
                isPrincipal: true,
              },
            },
            subscription: {
              create: {
                plan: dto.plan,
                cycle: BillingCycle.MONTHLY,
                price: PLAN_MONTHLY_PRICE[dto.plan],
                // 7 dias contando hoje: o último é hoje + 6.
                trialEndsAt: addDays(today, TRIAL_DAYS - 1),
              },
            },
          },
          select: { id: true },
        });
        const user = await tx.user.create({
          data: {
            name: dto.name,
            email: dto.email,
            password,
            type: UserType.ADMIN,
            companyId: company.id,
          },
          select: { id: true },
        });
        // Como no cadastro pelo SUPER_ADMIN: nascer ADMIN dá acesso aos dados
        // de saúde (anamnese), e isso fica na auditoria da própria empresa.
        await this.auditService.record(
          {
            companyId: company.id,
            userId: user.id,
            action: AuditAction.USER_TYPE_CHANGED,
            entityType: "USER",
            entityId: user.id,
          },
          tx,
        );
      });
    } catch (error) {
      // Corrida com outro cadastro igual entre a conferência e a gravação.
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          "Já existe um cadastro com este e-mail ou documento",
        );
      }
      throw error;
    }

    // Entra como no login: os mesmos tokens e as boas-vindas do primeiro acesso.
    return this.authService.login({ email: dto.email, password: dto.password });
  }

  // E-mail e documento livres, com a mensagem de cada um (o campo certo na tela).
  private async ensureFree(dto: SignupDto): Promise<void> {
    const [user, company] = await Promise.all([
      this.prisma.user.findFirst({
        where: { email: dto.email, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.company.findUnique({
        where: { document: dto.document },
        select: { id: true },
      }),
    ]);
    if (user) {
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        field: "email",
        message: "Este e-mail já tem cadastro no Orari. Entre pelo login.",
      });
    }
    if (company) {
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        field: "document",
        message: "Já existe uma empresa com este CPF ou CNPJ.",
      });
    }
  }

  // O nome vira o subdomínio; ocupado, ganha "-2", "-3"...
  private async freeSubdomain(base: string): Promise<string> {
    for (let attempt = 1; attempt <= 50; attempt += 1) {
      const candidate = attempt === 1 ? base : `${base}-${attempt}`;
      const taken = await this.prisma.company.findUnique({
        where: { subdomain: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    // Muito improvável: um sufixo aleatório resolve.
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
