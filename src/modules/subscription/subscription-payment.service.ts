import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AuditAction,
  type SubscriptionPaymentMethod,
} from "../../../generated/prisma/enums";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { localDateOf } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  CreateSubscriptionPaymentDto,
  SubscriptionPaymentQueryDto,
} from "./dto/create-subscription-payment.dto";
import { suggestPayment } from "./subscription-payment";

/** Fuso da tela Cobranças (o mês filtrado), o mesmo do Painel. */
const PLATFORM_TIME_ZONE = "America/Sao_Paulo";

export interface SubscriptionPaymentItem {
  id: string;
  companyId: string;
  companyName: string;
  amount: number;
  paidAt: string;
  method: SubscriptionPaymentMethod;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  /** Só o pagamento mais recente da empresa pode ser excluído. */
  removable: boolean;
}

const paymentSelect = {
  id: true,
  companyId: true,
  amount: true,
  paidAt: true,
  method: true,
  periodStart: true,
  periodEnd: true,
  note: true,
  createdAt: true,
  company: { select: { corporateReason: true, fantasyName: true } },
} as const;

type PaymentRow = {
  id: string;
  companyId: string;
  amount: { toNumber(): number };
  paidAt: Date;
  method: SubscriptionPaymentMethod;
  periodStart: Date;
  periodEnd: Date;
  note: string | null;
  company: { corporateReason: string; fantasyName: string | null };
};

/**
 * Cobranças da assinatura (ver docs/business-rules/empresa-e-acesso.md,
 * "Cobranças"): o SUPER_ADMIN registra o pagamento, que avança o "pago até";
 * excluir o último devolve o "pago até" anterior.
 */
@Injectable()
export class SubscriptionPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Pagamentos da empresa (mais recente primeiro) e a sugestão do próximo. */
  async listForCompany(companyId: string, now = new Date()) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { timezone: true, subscription: true },
    });
    if (!company) throw new NotFoundException("Empresa não encontrada");

    const rows = await this.prisma.subscriptionPayment.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      select: paymentSelect,
    });
    const sub = company.subscription;
    const suggestion = sub
      ? suggestPayment(
          { ...sub, price: sub.price.toNumber() },
          localDateOf(now, company.timezone),
        )
      : null;

    return {
      items: rows.map((row, index) => toItem(row, index === 0)),
      suggestion: suggestion && {
        periodStart: toText(suggestion.periodStart),
        periodEnd: toText(suggestion.periodEnd),
        amount: suggestion.amount,
      },
    };
  }

  /** Pagamentos de um mês (pela data do pagamento), de todas as empresas. */
  async listByMonth(query: SubscriptionPaymentQueryDto, now = new Date()) {
    const month =
      query.month ?? toText(localDateOf(now, PLATFORM_TIME_ZONE)).slice(0, 7);
    const from = new Date(`${month}-01T00:00:00Z`);
    const to = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1),
    );

    const [rows, latest] = await Promise.all([
      this.prisma.subscriptionPayment.findMany({
        where: { paidAt: { gte: from, lt: to } },
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        select: paymentSelect,
      }),
      // O último de cada empresa: só ele tem "Excluir".
      this.prisma.subscriptionPayment.findMany({
        distinct: ["companyId"],
        orderBy: [{ companyId: "asc" }, { createdAt: "desc" }],
        select: { id: true },
      }),
    ]);
    const latestIds = new Set(latest.map((row) => row.id));
    const items = rows.map((row) => toItem(row, latestIds.has(row.id)));
    const total = items.reduce((sum, item) => sum + item.amount, 0);

    return {
      month,
      items,
      total: Math.round(total * 100) / 100,
      count: items.length,
    };
  }

  // Registra o pagamento e avança o "pago até" (nunca o recua).
  async create(
    companyId: string,
    dto: CreateSubscriptionPaymentDto,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<SubscriptionPaymentItem> {
    const subscription = await this.prisma.companySubscription.findUnique({
      where: { companyId },
      select: { paidUntil: true },
    });
    if (!subscription) {
      throw new NotFoundException(
        "A empresa não tem assinatura: crie a assinatura antes de registrar pagamentos",
      );
    }
    const periodStart = asDate(dto.periodStart);
    const periodEnd = asDate(dto.periodEnd);
    if (periodEnd < periodStart) {
      throw new BadRequestException(
        "O fim do período não pode ser antes do início",
      );
    }
    const previous = subscription.paidUntil;
    const paidUntil = previous && previous > periodEnd ? previous : periodEnd;

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.subscriptionPayment.create({
        data: {
          companyId,
          amount: dto.amount,
          paidAt: asDate(dto.paidAt),
          method: dto.method,
          periodStart,
          periodEnd,
          previousPaidUntil: previous,
          note: dto.note?.trim() || null,
          createdById: currentUser.id,
        },
        select: paymentSelect,
      });
      await tx.companySubscription.update({
        where: { companyId },
        data: { paidUntil },
      });
      await this.auditService.record(
        {
          // Como na assinatura: o registro é da empresa do SUPER_ADMIN.
          companyId: currentUser.companyId,
          userId: currentUser.id,
          action: AuditAction.SUBSCRIPTION_PAYMENT_CREATED,
          entityType: "COMPANY",
          entityId: companyId,
          ip,
        },
        tx,
      );
      return created;
    });
    return toItem(row, true);
  }

  // Exclui o último pagamento (lançado por engano) e devolve o "pago até".
  async remove(
    companyId: string,
    paymentId: string,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<void> {
    const latest = await this.prisma.subscriptionPayment.findFirst({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      select: { id: true, previousPaidUntil: true },
    });
    if (!latest) throw new NotFoundException("Pagamento não encontrado");
    if (latest.id !== paymentId) {
      const exists = await this.prisma.subscriptionPayment.count({
        where: { id: paymentId, companyId },
      });
      if (!exists) throw new NotFoundException("Pagamento não encontrado");
      throw new ConflictException(
        "Só o pagamento mais recente pode ser excluído",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionPayment.delete({ where: { id: paymentId } });
      await tx.companySubscription.update({
        where: { companyId },
        data: { paidUntil: latest.previousPaidUntil },
      });
      await this.auditService.record(
        {
          companyId: currentUser.companyId,
          userId: currentUser.id,
          action: AuditAction.SUBSCRIPTION_PAYMENT_REMOVED,
          entityType: "COMPANY",
          entityId: companyId,
          ip,
        },
        tx,
      );
    });
  }
}

function toItem(row: PaymentRow, removable: boolean): SubscriptionPaymentItem {
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: row.company.fantasyName ?? row.company.corporateReason,
    amount: row.amount.toNumber(),
    paidAt: toText(row.paidAt),
    method: row.method,
    periodStart: toText(row.periodStart),
    periodEnd: toText(row.periodEnd),
    note: row.note,
    removable,
  };
}

// "AAAA-MM-DD" ↔ coluna `date` (UTC 00:00).
function asDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function toText(date: Date): string {
  return date.toISOString().slice(0, 10);
}
