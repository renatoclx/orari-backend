import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PeopleType } from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { periodOf } from "../../common/time/report-period";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { createCommissionPayable } from "../payable/commission-payable";
import { localToday } from "../receivables/receivables.service";
import type {
  CommissionAdvanceListQueryDto,
  CreateCommissionAdvanceDto,
} from "./dto/create-commission-advance.dto";

/** Saldo em aberto de um profissional (ainda não fechado). */
export interface OpenBalance {
  /** Comissão gerada e não fechada. */
  commission: Decimal;
  /** Adiantamentos não fechados. */
  advanced: Decimal;
}

/** Disponível para adiantar: a comissão em aberto menos o já adiantado. */
export const availableOf = ({ commission, advanced }: OpenBalance) =>
  Decimal.max(0, commission.minus(advanced));

export interface CommissionAdvanceItem {
  id: string;
  amount: string;
  /** AAAA-MM-DD. */
  date: string;
  note: string | null;
  /** Vazio nos lançados antes de o método existir. */
  paymentMethod: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
  /** Fechamento que o abateu; null = em aberto. */
  closing: { id: string; number: number } | null;
}

const advanceSelect = {
  id: true,
  amount: true,
  date: true,
  note: true,
  paymentMethod: { select: { id: true, name: true } },
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

/**
 * Adiantamentos de comissão (ver "Comissão" nas regras). Até o fechamento,
 * tudo o que existe está "em aberto": a comissão gerada e os adiantamentos.
 */
@Injectable()
export class CommissionAdvanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
  ) {}

  /** Saldo em aberto por profissional (todos, ou só o informado). */
  async openBalances(
    companyId: string,
    professionalId?: string,
  ): Promise<Map<string, OpenBalance>> {
    // Em aberto = sem fechamento.
    const where = { companyId, professionalId, closingId: null };
    const [commissions, advances] = await Promise.all([
      this.prisma.commission.groupBy({
        by: ["professionalId"],
        where,
        _sum: { amount: true },
      }),
      this.prisma.commissionAdvance.groupBy({
        by: ["professionalId"],
        where,
        _sum: { amount: true },
      }),
    ]);
    const balances = new Map<string, OpenBalance>();
    const balanceOf = (id: string) => {
      const current = balances.get(id) ?? {
        commission: new Decimal(0),
        advanced: new Decimal(0),
      };
      balances.set(id, current);
      return current;
    };
    for (const row of commissions) {
      balanceOf(row.professionalId).commission =
        row._sum.amount ?? new Decimal(0);
    }
    for (const row of advances) {
      balanceOf(row.professionalId).advanced =
        row._sum.amount ?? new Decimal(0);
    }
    return balances;
  }

  /** Quanto ainda pode ser adiantado ao profissional. */
  async available(professionalId: string, companyId: string) {
    await this.ensureProfessional(professionalId, companyId);
    const balance = (await this.openBalances(companyId, professionalId)).get(
      professionalId,
    );
    return {
      available: balance ? availableOf(balance).toFixed(2) : "0.00",
    };
  }

  /**
   * Os do período (em aberto ou fechados) e os em aberto de qualquer data,
   * para nenhum abatimento pendente ficar fora da lista.
   */
  async list(
    { professionalId, from, to }: CommissionAdvanceListQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<CommissionAdvanceItem[]> {
    await this.ensureProfessional(professionalId, companyId);
    const timeZone = await this.companyService.getTimeZone(companyId);
    const period = periodOf(from, to, timeZone, now);
    // A data do adiantamento é de calendário: compara com os dias do período.
    const first = localToday(period.start, timeZone);
    const last = localToday(new Date(period.end.getTime() - 1), timeZone);
    const rows = await this.prisma.commissionAdvance.findMany({
      where: {
        companyId,
        professionalId,
        OR: [{ closingId: null }, { date: { gte: first, lte: last } }],
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: {
        ...advanceSelect,
        closing: { select: { id: true, number: true } },
      },
    });
    return rows.map((row) => ({
      ...row,
      amount: row.amount.toFixed(2),
      date: row.date.toISOString().slice(0, 10),
    }));
  }

  /**
   * Lança o adiantamento: profissional da empresa, data até hoje (no fuso da
   * empresa) e valor até o disponível. O profissional fica travado durante a
   * conta, para dois lançamentos ao mesmo tempo não passarem juntos do limite.
   */
  async create(
    dto: CreateCommissionAdvanceDto,
    companyId: string,
    userId: string,
    now = new Date(),
  ): Promise<CommissionAdvanceItem> {
    await this.ensureProfessional(dto.professionalId, companyId);
    const timeZone = await this.companyService.getTimeZone(companyId);
    const date = new Date(`${dto.date}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date > localToday(now, timeZone)) {
      throw new BadRequestException("A data não pode ser futura");
    }
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id: dto.paymentMethodId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!method) {
      throw new BadRequestException("Escolha um método de pagamento ativo");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM people WHERE id = ${dto.professionalId} FOR UPDATE`;
      const [commission, advanced] = await Promise.all([
        tx.commission.aggregate({
          where: {
            companyId,
            professionalId: dto.professionalId,
            closingId: null,
          },
          _sum: { amount: true },
        }),
        tx.commissionAdvance.aggregate({
          where: {
            companyId,
            professionalId: dto.professionalId,
            closingId: null,
          },
          _sum: { amount: true },
        }),
      ]);
      const available = availableOf({
        commission: commission._sum.amount ?? new Decimal(0),
        advanced: advanced._sum.amount ?? new Decimal(0),
      });
      if (new Decimal(dto.amount).greaterThan(available)) {
        throw new BadRequestException(
          `O valor passa do disponível para adiantar (R$ ${available.toFixed(2).replace(".", ",")})`,
        );
      }
      const advance = await tx.commissionAdvance.create({
        data: {
          companyId,
          professionalId: dto.professionalId,
          amount: dto.amount,
          date,
          note: dto.note,
          paymentMethodId: dto.paymentMethodId,
          createdById: userId,
        },
        select: advanceSelect,
      });
      // O dinheiro saiu hoje: vira conta paga no Contas a pagar.
      await createCommissionPayable(tx, {
        companyId,
        professionalId: dto.professionalId,
        description: "Adiantamento de comissão",
        amount: dto.amount,
        paidAt: date,
        paymentMethodId: dto.paymentMethodId,
        createdById: userId,
        commissionAdvanceId: advance.id,
      });
      return advance;
    });
    return {
      ...created,
      amount: created.amount.toFixed(2),
      date: created.date.toISOString().slice(0, 10),
      // Acabou de ser lançado: está em aberto.
      closing: null,
    };
  }

  /** Exclui um lançamento errado (só enquanto não foi fechado: 409). */
  async remove(id: string, companyId: string): Promise<void> {
    const advance = await this.prisma.commissionAdvance.findFirst({
      where: { id, companyId },
      select: { id: true, closingId: true },
    });
    if (!advance) {
      throw new NotFoundException("Adiantamento não encontrado");
    }
    // Fechado: já foi abatido e está no recibo.
    if (advance.closingId) {
      throw new ConflictException(
        "O adiantamento já foi fechado e não pode ser excluído",
      );
    }
    // A conta paga gerada sai junto (lançamento errado).
    await this.prisma.$transaction([
      this.prisma.payable.deleteMany({ where: { commissionAdvanceId: id } }),
      this.prisma.commissionAdvance.delete({ where: { id } }),
    ]);
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
