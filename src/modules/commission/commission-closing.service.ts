import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PayableStatus, PeopleType } from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { periodOf } from "../../common/time/report-period";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { createCommissionPayable } from "../payable/commission-payable";
import { localToday } from "../receivables/receivables.service";
import type {
  CommissionClosingPreviewQueryDto,
  CreateCommissionClosingDto,
} from "./dto/commission-closing.dto";

/** O que está em aberto até a data de corte. */
export interface ClosingPreview {
  commissions: { count: number; amount: string };
  advances: { count: number; amount: string };
  /** Comissões − adiantamentos (nunca negativo). */
  toPay: string;
}

/** Cópia do detalhamento gravada no fechamento (o recibo sai dela). */
// Tipo (e não interface) para caber no Json do Prisma.
export type ClosingDetails = {
  commissions: {
    /** Início do atendimento (ISO). */
    startAt: string;
    client: string;
    service: string;
    base: string;
    amount: string;
  }[];
  advances: { date: string; note: string | null; amount: string }[];
};

export interface ClosingItem {
  id: string;
  number: number;
  cutoffDate: string;
  paidAt: string;
  paymentMethod: { id: string; name: string };
  commissionTotal: string;
  advanceTotal: string;
  paidAmount: string;
  appointmentsCount: number;
  createdBy: { id: string; name: string };
  createdAt: Date;
  cancelledAt: Date | null;
}

export interface ClosingReceipt extends ClosingItem {
  company: { name: string; corporateReason: string; document: string };
  professional: { id: string; name: string; document: string | null };
  cancelledBy: { id: string; name: string } | null;
  details: ClosingDetails;
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (value: string) => new Date(`${value}T00:00:00Z`);

const closingSelect = {
  id: true,
  number: true,
  cutoffDate: true,
  paidAt: true,
  paymentMethod: { select: { id: true, name: true } },
  commissionTotal: true,
  advanceTotal: true,
  paidAmount: true,
  appointmentsCount: true,
  createdBy: { select: { id: true, name: true } },
  createdAt: true,
  cancelledAt: true,
} as const;

type ClosingRow = {
  id: string;
  number: number;
  cutoffDate: Date;
  paidAt: Date;
  paymentMethod: { id: string; name: string };
  commissionTotal: Decimal;
  advanceTotal: Decimal;
  paidAmount: Decimal;
  appointmentsCount: number;
  createdBy: { id: string; name: string };
  createdAt: Date;
  cancelledAt: Date | null;
};

const itemOf = (row: ClosingRow): ClosingItem => ({
  ...row,
  cutoffDate: day(row.cutoffDate),
  paidAt: day(row.paidAt),
  commissionTotal: row.commissionTotal.toFixed(2),
  advanceTotal: row.advanceTotal.toFixed(2),
  paidAmount: row.paidAmount.toFixed(2),
});

/**
 * Fechamento da comissão (ver "Comissão" nas regras): quita tudo o que está em
 * aberto do profissional até a data de corte, registra o pagamento e gera o
 * recibo. Só o último do profissional pode ser desfeito.
 */
@Injectable()
export class CommissionClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
  ) {}

  async preview(
    { professionalId, until }: CommissionClosingPreviewQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<ClosingPreview> {
    await this.ensureProfessional(professionalId, companyId);
    const where = await this.openUntil(professionalId, until, companyId, now);
    const [commissions, advances] = await Promise.all([
      this.prisma.commission.aggregate({
        where: where.commissions,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.commissionAdvance.aggregate({
        where: where.advances,
        _sum: { amount: true },
        _count: true,
      }),
    ]);
    const commissionTotal = commissions._sum.amount ?? new Decimal(0);
    const advanceTotal = advances._sum.amount ?? new Decimal(0);
    return {
      commissions: {
        count: commissions._count,
        amount: commissionTotal.toFixed(2),
      },
      advances: { count: advances._count, amount: advanceTotal.toFixed(2) },
      toPay: Decimal.max(0, commissionTotal.minus(advanceTotal)).toFixed(2),
    };
  }

  /**
   * Fecha: confere o método (ativo, da empresa) e as datas (até hoje), trava a
   * empresa (número do recibo) e o profissional, junta o que está em aberto,
   * grava o fechamento com a cópia do detalhamento e marca tudo como fechado.
   */
  async create(
    dto: CreateCommissionClosingDto,
    companyId: string,
    userId: string,
    now = new Date(),
  ): Promise<{ id: string; number: number }> {
    await this.ensureProfessional(dto.professionalId, companyId);
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id: dto.paymentMethodId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!method) {
      throw new BadRequestException("Escolha um método de pagamento ativo");
    }
    const timeZone = await this.companyService.getTimeZone(companyId);
    const today = localToday(now, timeZone);
    if (asDate(dto.until) > today) {
      throw new BadRequestException("A data de corte não pode ser futura");
    }
    if (asDate(dto.paidAt) > today) {
      throw new BadRequestException("A data do pagamento não pode ser futura");
    }
    const where = await this.openUntil(
      dto.professionalId,
      dto.until,
      companyId,
      now,
    );

    return this.prisma.$transaction(async (tx) => {
      // A empresa serializa a numeração; o profissional, os lançamentos dele.
      await tx.$queryRaw`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM people WHERE id = ${dto.professionalId} FOR UPDATE`;

      const [commissions, advances] = await Promise.all([
        tx.commission.findMany({
          where: where.commissions,
          orderBy: { appointment: { startAt: "asc" } },
          select: {
            id: true,
            baseAmount: true,
            amount: true,
            appointment: {
              select: {
                startAt: true,
                client: { select: { name: true } },
                service: { select: { name: true } },
              },
            },
          },
        }),
        tx.commissionAdvance.findMany({
          where: where.advances,
          orderBy: [{ date: "asc" }, { createdAt: "asc" }],
          select: { id: true, date: true, note: true, amount: true },
        }),
      ]);
      if (commissions.length === 0 && advances.length === 0) {
        throw new BadRequestException("Nada em aberto até esta data");
      }

      const sum = (rows: { amount: Decimal }[]) =>
        rows.reduce((acc, row) => acc.plus(row.amount), new Decimal(0));
      const commissionTotal = sum(commissions);
      const advanceTotal = sum(advances);
      const details: ClosingDetails = {
        commissions: commissions.map((row) => ({
          startAt: row.appointment.startAt.toISOString(),
          client: row.appointment.client.name,
          service: row.appointment.service.name,
          base: row.baseAmount.toFixed(2),
          amount: row.amount.toFixed(2),
        })),
        advances: advances.map((row) => ({
          date: day(row.date),
          note: row.note,
          amount: row.amount.toFixed(2),
        })),
      };
      const last = await tx.commissionClosing.aggregate({
        where: { companyId },
        _max: { number: true },
      });

      const paidAmount = Decimal.max(0, commissionTotal.minus(advanceTotal));
      const closing = await tx.commissionClosing.create({
        data: {
          companyId,
          number: (last._max.number ?? 0) + 1,
          professionalId: dto.professionalId,
          cutoffDate: asDate(dto.until),
          paidAt: asDate(dto.paidAt),
          paymentMethodId: dto.paymentMethodId,
          commissionTotal,
          advanceTotal,
          paidAmount,
          appointmentsCount: commissions.length,
          details,
          createdById: userId,
        },
        select: { id: true, number: true },
      });
      await Promise.all([
        tx.commission.updateMany({
          where: { id: { in: commissions.map((row) => row.id) } },
          data: { closingId: closing.id },
        }),
        tx.commissionAdvance.updateMany({
          where: { id: { in: advances.map((row) => row.id) } },
          data: { closingId: closing.id },
        }),
      ]);
      // O valor pago vira conta paga no Contas a pagar (zero: nada saiu).
      if (paidAmount.greaterThan(0)) {
        await createCommissionPayable(tx, {
          companyId,
          professionalId: dto.professionalId,
          description: `Comissão nº ${String(closing.number).padStart(4, "0")}`,
          amount: paidAmount,
          paidAt: asDate(dto.paidAt),
          paymentMethodId: dto.paymentMethodId,
          createdById: userId,
          commissionClosingId: closing.id,
        });
      }
      return closing;
    });
  }

  /** Fechamentos do profissional, do mais recente (inclusive os desfeitos). */
  async list(
    professionalId: string,
    companyId: string,
  ): Promise<ClosingItem[]> {
    await this.ensureProfessional(professionalId, companyId);
    const rows = await this.prisma.commissionClosing.findMany({
      where: { companyId, professionalId },
      orderBy: { number: "desc" },
      select: closingSelect,
    });
    return rows.map(itemOf);
  }

  /** Dados do recibo (também do fechamento desfeito, marcado como tal). */
  async receipt(id: string, companyId: string): Promise<ClosingReceipt> {
    const row = await this.prisma.commissionClosing.findFirst({
      where: { id, companyId },
      select: {
        ...closingSelect,
        details: true,
        cancelledBy: { select: { id: true, name: true } },
        company: {
          select: { fantasyName: true, corporateReason: true, document: true },
        },
        professional: { select: { id: true, name: true, document: true } },
      },
    });
    if (!row) throw new NotFoundException("Fechamento não encontrado");
    const { company, details, ...rest } = row;
    return {
      ...itemOf(rest),
      cancelledBy: rest.cancelledBy,
      professional: rest.professional,
      company: {
        name: company.fantasyName ?? company.corporateReason,
        corporateReason: company.corporateReason,
        document: company.document,
      },
      details: details as unknown as ClosingDetails,
    };
  }

  /**
   * Desfaz o fechamento: só o último (não desfeito) do profissional. Fica
   * marcado como cancelado (o número não volta) e tudo volta ao "em aberto".
   */
  async cancel(id: string, companyId: string, userId: string): Promise<void> {
    const closing = await this.prisma.commissionClosing.findFirst({
      where: { id, companyId },
      select: { id: true, professionalId: true, cancelledAt: true },
    });
    if (!closing) throw new NotFoundException("Fechamento não encontrado");
    if (closing.cancelledAt) {
      throw new ConflictException("Este fechamento já foi desfeito");
    }
    const latest = await this.prisma.commissionClosing.findFirst({
      where: {
        companyId,
        professionalId: closing.professionalId,
        cancelledAt: null,
      },
      orderBy: { number: "desc" },
      select: { id: true },
    });
    if (latest?.id !== id) {
      throw new ConflictException(
        "Só o último fechamento do profissional pode ser desfeito",
      );
    }
    await this.prisma.$transaction([
      this.prisma.commissionClosing.update({
        where: { id },
        data: { cancelledAt: new Date(), cancelledById: userId },
      }),
      this.prisma.commission.updateMany({
        where: { closingId: id },
        data: { closingId: null },
      }),
      this.prisma.commissionAdvance.updateMany({
        where: { closingId: id },
        data: { closingId: null },
      }),
      // A conta paga do fechamento fica cancelada (no histórico).
      this.prisma.payable.updateMany({
        where: { commissionClosingId: id },
        data: {
          status: PayableStatus.CANCELLED,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        },
      }),
    ]);
  }

  // Em aberto até a data de corte: comissões de atendimentos que começaram até
  // o fim desse dia (no fuso da empresa) e adiantamentos com data até ela.
  private async openUntil(
    professionalId: string,
    until: string,
    companyId: string,
    now: Date,
  ) {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const { end } = periodOf(until, until, timeZone, now);
    return {
      commissions: {
        companyId,
        professionalId,
        closingId: null,
        appointment: { startAt: { lt: end } },
      },
      advances: {
        companyId,
        professionalId,
        closingId: null,
        date: { lte: asDate(until) },
      },
    };
  }

  private async ensureProfessional(id: string, companyId: string) {
    const professional = await this.prisma.people.findFirst({
      where: { id, companyId, type: PeopleType.PROFESSIONAL },
      select: { id: true },
    });
    if (!professional) {
      throw new NotFoundException("Profissional não encontrado");
    }
  }
}
