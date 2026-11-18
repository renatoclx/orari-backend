import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditAction } from "../../../generated/prisma/enums";
import type {
  BillingCycle,
  SubscriptionPlan,
} from "../../../generated/prisma/enums";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { localDateOf } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { UpdateSubscriptionDto } from "./dto/update-subscription.dto";
import {
  subscriptionState,
  type SubscriptionDates,
  type SubscriptionState,
  type SubscriptionStatus,
} from "./subscription-status";

export interface SubscriptionResponse {
  plan: SubscriptionPlan;
  cycle: BillingCycle;
  extraProfessionals: number;
  anamnesisAddon: boolean;
  price: number;
  discountPercent: number | null;
  discountUntil: string | null;
  trialEndsAt: string | null;
  paidUntil: string | null;
  canceledAt: string | null;
  status: SubscriptionStatus;
  readOnly: boolean;
  endsAt: string | null;
}

/** Uma linha da tela de assinaturas: a empresa, com ou sem assinatura. */
export interface CompanySubscriptionItem {
  companyId: string;
  companyName: string;
  isActive: boolean;
  subscription: SubscriptionResponse | null;
}

/** O que a própria empresa vê (GET /auth/me) para mostrar a faixa de aviso. */
export interface SubscriptionSummary {
  status: SubscriptionStatus;
  readOnly: boolean;
  endsAt: string | null;
}

// Mensagem padrão da recusa; o código permite à tela distinguir a situação.
const READ_ONLY_MESSAGE =
  "A empresa está em somente leitura. Regularize a assinatura para voltar a alterar os dados.";

type SubscriptionRow = SubscriptionDates & {
  plan: SubscriptionPlan;
  cycle: BillingCycle;
  extraProfessionals: number;
  anamnesisAddon: boolean;
  price: { toNumber(): number };
  discountPercent: number | null;
  discountUntil: Date | null;
};

/**
 * Assinatura de cada empresa (ver docs/business-rules/empresa-e-acesso.md,
 * "Assinatura"). Só o SUPER_ADMIN lê e grava; a situação, calculada pelas
 * datas no fuso da empresa, decide se ela pode gravar dados.
 */
@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Todas as empresas (menos a da plataforma), com a assinatura de cada uma. */
  async findAll(
    currentUser: AuthenticatedUser,
    now = new Date(),
  ): Promise<CompanySubscriptionItem[]> {
    const companies = await this.prisma.company.findMany({
      where: { id: { not: currentUser.companyId } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        corporateReason: true,
        fantasyName: true,
        isActive: true,
        timezone: true,
        subscription: true,
      },
    });
    return companies.map((company) => ({
      companyId: company.id,
      companyName: company.fantasyName ?? company.corporateReason,
      isActive: company.isActive,
      subscription: company.subscription
        ? toResponse(company.subscription, localDateOf(now, company.timezone))
        : null,
    }));
  }

  async findOne(
    companyId: string,
    now = new Date(),
  ): Promise<SubscriptionResponse | null> {
    const company = await this.findCompany(companyId);
    return company.subscription
      ? toResponse(company.subscription, localDateOf(now, company.timezone))
      : null;
  }

  // Cria ou substitui a assinatura; a mudança fica no log de auditoria.
  async replace(
    companyId: string,
    dto: UpdateSubscriptionDto,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<SubscriptionResponse | null> {
    await this.findCompany(companyId);
    if (!dto.trialEndsAt && !dto.paidUntil) {
      // Sem nenhuma das duas datas a assinatura nasceria em somente leitura.
      throw new BadRequestException(
        "Informe o fim do teste ou até quando está pago",
      );
    }
    const hasDiscount = dto.discountPercent != null;
    const data = {
      plan: dto.plan,
      cycle: dto.cycle,
      extraProfessionals: dto.extraProfessionals,
      anamnesisAddon: dto.anamnesisAddon,
      price: dto.price,
      discountPercent: hasDiscount ? dto.discountPercent : null,
      discountUntil: hasDiscount ? asDate(dto.discountUntil) : null,
      trialEndsAt: asDate(dto.trialEndsAt),
      paidUntil: asDate(dto.paidUntil),
      canceledAt: asDate(dto.canceledAt),
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.companySubscription.upsert({
        where: { companyId },
        create: { companyId, ...data },
        update: data,
      });
      await this.auditService.record(
        {
          // Como nos acessos: o registro é da empresa do SUPER_ADMIN.
          companyId: currentUser.companyId,
          userId: currentUser.id,
          action: AuditAction.SUBSCRIPTION_CHANGED,
          entityType: "COMPANY",
          entityId: companyId,
          ip,
        },
        tx,
      );
    });

    return this.findOne(companyId);
  }

  /** Situação atual da empresa; nula quando ela não tem assinatura (sem restrição). */
  async stateOf(
    companyId: string,
    now = new Date(),
  ): Promise<SubscriptionState | null> {
    const row = await this.prisma.companySubscription.findUnique({
      where: { companyId },
      select: {
        trialEndsAt: true,
        paidUntil: true,
        canceledAt: true,
        company: { select: { timezone: true } },
      },
    });
    if (!row) return null;
    return subscriptionState(row, localDateOf(now, row.company.timezone));
  }

  async summaryOf(companyId: string): Promise<SubscriptionSummary | null> {
    const state = await this.stateOf(companyId);
    return state
      ? {
          status: state.status,
          readOnly: state.readOnly,
          endsAt: toText(state.endsAt),
        }
      : null;
  }

  /** Recusa a gravação da empresa em somente leitura (403, `SUBSCRIPTION_READ_ONLY`). */
  async assertWritable(
    companyId: string,
    message = READ_ONLY_MESSAGE,
  ): Promise<void> {
    const state = await this.stateOf(companyId);
    if (!state?.readOnly) return;
    throw new ForbiddenException({
      statusCode: 403,
      error: "Forbidden",
      code: "SUBSCRIPTION_READ_ONLY",
      message,
    });
  }

  private async findCompany(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { timezone: true, subscription: true },
    });
    if (!company) throw new NotFoundException("Empresa não encontrada");
    return company;
  }
}

function toResponse(row: SubscriptionRow, today: Date): SubscriptionResponse {
  const state = subscriptionState(row, today);
  return {
    plan: row.plan,
    cycle: row.cycle,
    extraProfessionals: row.extraProfessionals,
    anamnesisAddon: row.anamnesisAddon,
    price: row.price.toNumber(),
    discountPercent: row.discountPercent,
    discountUntil: toText(row.discountUntil),
    trialEndsAt: toText(row.trialEndsAt),
    paidUntil: toText(row.paidUntil),
    canceledAt: toText(row.canceledAt),
    status: state.status,
    readOnly: state.readOnly,
    endsAt: toText(state.endsAt),
  };
}

// "AAAA-MM-DD" ↔ coluna `date` (UTC 00:00).
function asDate(value?: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00Z`) : null;
}

function toText(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}
