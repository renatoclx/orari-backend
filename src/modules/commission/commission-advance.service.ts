import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PeopleType } from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { localToday } from "../receivables/receivables.service";
import type { CreateCommissionAdvanceDto } from "./dto/create-commission-advance.dto";

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
  createdBy: { id: string; name: string };
  createdAt: Date;
}

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
    const where = { companyId, professionalId };
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

  async list(
    professionalId: string,
    companyId: string,
  ): Promise<CommissionAdvanceItem[]> {
    await this.ensureProfessional(professionalId, companyId);
    const rows = await this.prisma.commissionAdvance.findMany({
      where: { companyId, professionalId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        amount: true,
        date: true,
        note: true,
        createdAt: true,
        createdBy: { select: { id: true, name: true } },
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

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM people WHERE id = ${dto.professionalId} FOR UPDATE`;
      const [commission, advanced] = await Promise.all([
        tx.commission.aggregate({
          where: { companyId, professionalId: dto.professionalId },
          _sum: { amount: true },
        }),
        tx.commissionAdvance.aggregate({
          where: { companyId, professionalId: dto.professionalId },
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
      return tx.commissionAdvance.create({
        data: {
          companyId,
          professionalId: dto.professionalId,
          amount: dto.amount,
          date,
          note: dto.note,
          createdById: userId,
        },
        select: {
          id: true,
          amount: true,
          date: true,
          note: true,
          createdAt: true,
          createdBy: { select: { id: true, name: true } },
        },
      });
    });
    return {
      ...created,
      amount: created.amount.toFixed(2),
      date: created.date.toISOString().slice(0, 10),
    };
  }

  /** Exclui um lançamento errado (enquanto não houver fechamento). */
  async remove(id: string, companyId: string): Promise<void> {
    const advance = await this.prisma.commissionAdvance.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!advance) {
      throw new NotFoundException("Adiantamento não encontrado");
    }
    await this.prisma.commissionAdvance.delete({ where: { id } });
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
