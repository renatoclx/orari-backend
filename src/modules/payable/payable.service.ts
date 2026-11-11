import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PayableStatus, PeopleType } from "../../../generated/prisma/enums";
import type { Prisma } from "../../../generated/prisma/client";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";

type PayableWhereInput = Prisma.PayableWhereInput;
import type { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { calculateDueDates } from "../client-plan/client-plan.calculations";
import {
  CommissionAdvanceService,
  availableOf,
} from "../commission/commission-advance.service";
import { CompanyService } from "../company/company.service";
import { localDateOf } from "../../common/time/time-zone";
import type {
  CreatePayableDto,
  PayableRepeatDto,
} from "./dto/create-payable.dto";
import type {
  PayableFilter,
  PayableListQueryDto,
  PayableSummaryQueryDto,
} from "./dto/payable-query.dto";
import type { SettlePayablesDto } from "./dto/settle-payables.dto";
import type { UpdatePayableDto } from "./dto/update-payable.dto";

const asDate = (value: string) => new Date(`${value}T00:00:00Z`);
const day = (date: Date) => date.toISOString().slice(0, 10);

/** Uma conta da série: valor, vencimento e "parcela i de n". */
export interface SeriesEntry {
  amount: Decimal;
  dueDate: Date;
  installment: number | null;
  installments: number | null;
}

/**
 * Divide o total em N parcelas em centavos: as N−1 primeiras com o valor
 * arredondado para baixo e a última com o resto, para a soma fechar.
 */
export function splitAmount(total: Decimal, count: number): Decimal[] {
  const cents = total.times(100).toNumber();
  const base = Math.floor(cents / count);
  return Array.from({ length: count }, (_, index) =>
    new Decimal(index === count - 1 ? cents - base * (count - 1) : base).div(
      100,
    ),
  );
}

/**
 * As contas a gerar (função pura): uma só sem repetição; com ela, uma por mês
 * a partir do primeiro vencimento (dia 31 cai no último dia do mês). Parcelar
 * divide o valor; repetir mantém o mesmo valor em cada mês.
 */
export function buildSeries(
  amount: Decimal,
  firstDue: Date,
  repeat?: PayableRepeatDto,
): SeriesEntry[] {
  if (!repeat) {
    return [
      { amount, dueDate: firstDue, installment: null, installments: null },
    ];
  }
  const dates = calculateDueDates(firstDue, repeat.count);
  const amounts =
    repeat.mode === "installments"
      ? splitAmount(amount, repeat.count)
      : dates.map(() => amount);
  return dates.map((dueDate, index) => ({
    amount: amounts[index],
    dueDate,
    installment: index + 1,
    installments: repeat.count,
  }));
}

/** Filtro da situação ("atrasada" e "a vencer" são pendentes pela data). */
export function statusWhere(
  filter: PayableFilter,
  today: Date,
): PayableWhereInput {
  switch (filter) {
    case "overdue":
      return { status: PayableStatus.PENDING, dueDate: { lt: today } };
    case "upcoming":
      return { status: PayableStatus.PENDING, dueDate: { gte: today } };
    case "paid":
      return { status: PayableStatus.PAID };
    case "cancelled":
      return { status: PayableStatus.CANCELLED };
    case "all":
      return {};
    default:
      return { status: PayableStatus.PENDING };
  }
}

export interface PayableItem {
  id: string;
  description: string;
  payee: { id: string; name: string; type: PeopleType } | null;
  category: { id: string; name: string };
  amount: string;
  dueDate: string;
  note: string | null;
  status: PayableStatus;
  /** Pendente com vencimento antes de hoje. */
  overdue: boolean;
  paidAt: string | null;
  paymentMethod: { id: string; name: string } | null;
  seriesId: string | null;
  installment: number | null;
  installments: number | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
  cancelledAt: Date | null;
  /** Gerada pelo fechamento da comissão (o recibo é dele). */
  commissionClosing: { id: string; number: number } | null;
  /** Gerada por um adiantamento de comissão. */
  commissionAdvanceId: string | null;
}

/** Comissão em aberto de um profissional (linha calculada, sem conta). */
export interface PayableCommission {
  id: string;
  name: string;
  /** Comissão gerada e não fechada. */
  commission: string;
  /** Adiantamentos não fechados. */
  advanced: string;
  /** O que falta pagar: comissão menos adiantado (nunca negativo). */
  toPay: string;
}

export interface PayableTotal {
  count: number;
  amount: string;
}

export interface PayableSummary {
  overdue: PayableTotal;
  upcoming: PayableTotal;
  paid: PayableTotal;
}

const itemSelect = {
  id: true,
  description: true,
  payee: { select: { id: true, name: true, type: true } },
  category: { select: { id: true, name: true } },
  amount: true,
  dueDate: true,
  note: true,
  status: true,
  paidAt: true,
  paymentMethod: { select: { id: true, name: true } },
  seriesId: true,
  installment: true,
  installments: true,
  createdBy: { select: { id: true, name: true } },
  createdAt: true,
  cancelledAt: true,
  commissionClosing: { select: { id: true, number: true } },
  commissionAdvanceId: true,
} as const;

const protectedSelect = {
  status: true,
  commissionClosingId: true,
  commissionAdvanceId: true,
} as const;

/** A conta gerada pela comissão só muda pela tela Comissões (409). */
function ensureNotFromCommission(payable: {
  commissionClosingId: string | null;
  commissionAdvanceId: string | null;
}) {
  if (payable.commissionClosingId) {
    throw new ConflictException(
      "Conta gerada pelo fechamento da comissão: desfaça o fechamento em Comissões",
    );
  }
  if (payable.commissionAdvanceId) {
    throw new ConflictException(
      "Conta gerada por um adiantamento: exclua o adiantamento em Comissões",
    );
  }
}

/**
 * Contas a pagar (ver docs/business-rules/financeiro.md, "Contas a pagar"). Só o ADMIN;
 * tudo restrito à empresa do usuário.
 */
@Injectable()
export class PayableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
    private readonly advanceService: CommissionAdvanceService,
  ) {}

  /**
   * Comissões em aberto por profissional (o mesmo saldo do "A pagar" da tela
   * Comissões). Não são contas: quitam-se pelo fechamento.
   */
  async commissions(
    companyId: string,
    professionalId?: string,
  ): Promise<PayableCommission[]> {
    const balances = await this.advanceService.openBalances(
      companyId,
      professionalId,
    );
    if (balances.size === 0) return [];
    const people = await this.prisma.people.findMany({
      where: { id: { in: [...balances.keys()] }, companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return people.map(({ id, name }) => {
      const balance = balances.get(id)!;
      return {
        id,
        name,
        commission: balance.commission.toFixed(2),
        advanced: balance.advanced.toFixed(2),
        toPay: availableOf(balance).toFixed(2),
      };
    });
  }

  async summary(
    query: PayableSummaryQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<PayableSummary> {
    const today = await this.today(companyId, now);
    const base = this.baseWhere(query, companyId);
    const total = async (filter: PayableFilter): Promise<PayableTotal> => {
      const result = await this.prisma.payable.aggregate({
        where: { ...base, ...statusWhere(filter, today) },
        _sum: { amount: true },
        _count: true,
      });
      return {
        count: result._count,
        amount: (result._sum.amount ?? new Decimal(0)).toFixed(2),
      };
    };
    const [overdue, upcoming, paid] = await Promise.all([
      total("overdue"),
      total("upcoming"),
      total("paid"),
    ]);
    return { overdue, upcoming, paid };
  }

  async list(
    { page, limit, status = "pending", ...query }: PayableListQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<PaginatedResult<PayableItem>> {
    const today = await this.today(companyId, now);
    const where = {
      ...this.baseWhere(query, companyId),
      ...statusWhere(status, today),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payable.findMany({
        where,
        select: itemSelect,
        // As pagas, da mais recente; as demais, do vencimento mais próximo.
        orderBy:
          status === "paid"
            ? [{ paidAt: "desc" }, { createdAt: "desc" }]
            : [{ dueDate: "asc" }, { createdAt: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payable.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.itemOf(row, today)),
      total,
      page,
      limit,
    };
  }

  /**
   * Lança a conta (ou a série). "Já está paga" só sem repetição: a conta nasce
   * paga, com a data (até hoje) e o método.
   */
  async create(
    dto: CreatePayableDto,
    companyId: string,
    userId: string,
    now = new Date(),
  ): Promise<{ seriesId: string | null; count: number }> {
    await this.ensurePayee(dto.payeeId, companyId);
    await this.ensureCategory(dto.categoryId, companyId);
    if (dto.paid) {
      if (dto.repeat) {
        throw new BadRequestException(
          "Conta repetida ou parcelada não nasce paga: pague cada uma depois",
        );
      }
      await this.ensureMethod(dto.paid.paymentMethodId, companyId);
      await this.ensureNotFuture(dto.paid.paidAt, companyId, now);
    }

    const seriesId = dto.repeat ? randomUUID() : null;
    const entries = buildSeries(
      new Decimal(dto.amount),
      asDate(dto.dueDate),
      dto.repeat,
    );
    await this.prisma.payable.createMany({
      data: entries.map((entry) => ({
        companyId,
        description: dto.description.trim(),
        payeeId: dto.payeeId ?? null,
        categoryId: dto.categoryId,
        amount: entry.amount,
        dueDate: entry.dueDate,
        note: dto.note?.trim() || null,
        seriesId,
        installment: entry.installment,
        installments: entry.installments,
        createdById: userId,
        ...(dto.paid && {
          status: PayableStatus.PAID,
          paidAt: asDate(dto.paid.paidAt),
          paymentMethodId: dto.paid.paymentMethodId,
        }),
      })),
    });
    return { seriesId, count: entries.length };
  }

  /** Altera só esta conta, e só se estiver pendente. */
  async update(
    id: string,
    dto: UpdatePayableDto,
    companyId: string,
    now = new Date(),
  ): Promise<PayableItem> {
    await this.findPending(id, companyId, "alterada");
    if (dto.payeeId !== undefined)
      await this.ensurePayee(dto.payeeId, companyId);
    if (dto.categoryId !== undefined) {
      await this.ensureCategory(dto.categoryId, companyId);
    }
    const row = await this.prisma.payable.update({
      where: { id },
      data: {
        ...(dto.description !== undefined && {
          description: dto.description.trim(),
        }),
        ...(dto.payeeId !== undefined && { payeeId: dto.payeeId }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.dueDate !== undefined && { dueDate: asDate(dto.dueDate) }),
        ...(dto.note !== undefined && { note: dto.note?.trim() || null }),
        updatedAt: new Date(),
      },
      select: itemSelect,
    });
    return this.itemOf(row, await this.today(companyId, now));
  }

  /** Paga uma ou várias contas pendentes (tudo ou nada). */
  async settle(
    { ids, paidAt, paymentMethodId }: SettlePayablesDto,
    companyId: string,
    now = new Date(),
  ): Promise<{ settled: number }> {
    await this.ensureMethod(paymentMethodId, companyId);
    await this.ensureNotFuture(paidAt, companyId, now);
    const pending = await this.prisma.payable.count({
      where: { id: { in: ids }, companyId, status: PayableStatus.PENDING },
    });
    if (pending !== ids.length) {
      throw new ConflictException(
        "Só contas pendentes da empresa podem ser pagas",
      );
    }
    const result = await this.prisma.payable.updateMany({
      // O status no where impede pagar duas vezes numa corrida.
      where: { id: { in: ids }, companyId, status: PayableStatus.PENDING },
      data: {
        status: PayableStatus.PAID,
        paidAt: asDate(paidAt),
        paymentMethodId,
        updatedAt: new Date(),
      },
    });
    return { settled: result.count };
  }

  /** Cancela a conta pendente (fica no histórico como cancelada). */
  async cancel(id: string, companyId: string): Promise<void> {
    await this.findPending(id, companyId, "cancelada");
    const now = new Date();
    await this.prisma.payable.update({
      where: { id },
      data: {
        status: PayableStatus.CANCELLED,
        cancelledAt: now,
        updatedAt: now,
      },
    });
  }

  /** Exclui um lançamento errado (pendente ou cancelado; pago não). */
  async remove(id: string, companyId: string): Promise<void> {
    const payable = await this.prisma.payable.findFirst({
      where: { id, companyId },
      select: protectedSelect,
    });
    if (!payable) throw new NotFoundException("Conta a pagar não encontrada");
    ensureNotFromCommission(payable);
    if (payable.status === PayableStatus.PAID) {
      throw new ConflictException("Conta paga não pode ser excluída");
    }
    await this.prisma.payable.delete({ where: { id } });
  }

  // Favorecido, categoria e período de vencimento (comuns ao resumo e à lista).
  private baseWhere(
    { payeeId, categoryId, dueFrom, dueTo }: PayableSummaryQueryDto,
    companyId: string,
  ): PayableWhereInput {
    return {
      companyId,
      payeeId,
      categoryId,
      ...((dueFrom || dueTo) && {
        dueDate: {
          ...(dueFrom && { gte: asDate(dueFrom) }),
          ...(dueTo && { lte: asDate(dueTo) }),
        },
      }),
    };
  }

  private itemOf(
    row: {
      amount: Decimal;
      dueDate: Date;
      paidAt: Date | null;
      status: PayableStatus;
    } & Omit<
      PayableItem,
      "amount" | "dueDate" | "paidAt" | "overdue" | "status"
    >,
    today: Date,
  ): PayableItem {
    return {
      ...row,
      amount: row.amount.toFixed(2),
      dueDate: day(row.dueDate),
      paidAt: row.paidAt ? day(row.paidAt) : null,
      overdue: row.status === PayableStatus.PENDING && row.dueDate < today,
    };
  }

  private async findPending(id: string, companyId: string, verb: string) {
    const payable = await this.prisma.payable.findFirst({
      where: { id, companyId },
      select: protectedSelect,
    });
    if (!payable) throw new NotFoundException("Conta a pagar não encontrada");
    ensureNotFromCommission(payable);
    if (payable.status !== PayableStatus.PENDING) {
      throw new ConflictException(`Só conta pendente pode ser ${verb}`);
    }
  }

  /**
   * Confere o que uma conta nova precisa (favorecido, categoria e, se já
   * paga, método e data) para quem a lança por outro caminho, dentro da
   * própria transação (ex.: entrada de estoque por compra).
   */
  async ensureNewPayable(
    input: {
      payeeId?: string | null;
      categoryId: string;
      paid?: { paidAt: string; paymentMethodId: string };
    },
    companyId: string,
    now = new Date(),
  ): Promise<void> {
    await this.ensurePayee(input.payeeId, companyId);
    await this.ensureCategory(input.categoryId, companyId);
    if (input.paid) {
      await this.ensureMethod(input.paid.paymentMethodId, companyId);
      await this.ensureNotFuture(input.paid.paidAt, companyId, now);
    }
  }

  private async today(companyId: string, now: Date) {
    return localDateOf(now, await this.companyService.getTimeZone(companyId));
  }

  private async ensureNotFuture(date: string, companyId: string, now: Date) {
    if (asDate(date) > (await this.today(companyId, now))) {
      throw new BadRequestException("A data do pagamento não pode ser futura");
    }
  }

  // Favorecido: fornecedor ou profissional ativo da empresa (ou nenhum).
  private async ensurePayee(
    payeeId: string | null | undefined,
    companyId: string,
  ) {
    if (!payeeId) return;
    const payee = await this.prisma.people.findFirst({
      where: {
        id: payeeId,
        companyId,
        deletedAt: null,
        type: { in: [PeopleType.SUPPLIER, PeopleType.PROFESSIONAL] },
      },
      select: { id: true },
    });
    if (!payee) {
      throw new BadRequestException(
        "O favorecido precisa ser um fornecedor ou profissional ativo",
      );
    }
  }

  private async ensureCategory(categoryId: string, companyId: string) {
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: categoryId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!category) {
      throw new BadRequestException("Escolha uma categoria de despesa ativa");
    }
  }

  private async ensureMethod(paymentMethodId: string, companyId: string) {
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id: paymentMethodId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!method) {
      throw new BadRequestException("Escolha um método de pagamento ativo");
    }
  }
}
