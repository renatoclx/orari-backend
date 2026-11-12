import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PeopleType } from "../../../generated/prisma/enums";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { toZonedParts } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CommissionClosingService,
  type ClosingItem,
} from "../commission/commission-closing.service";
import { CommissionService } from "../commission/commission.service";
import { CompanyAccessService } from "../company-access/company-access.service";
import { CompanyService } from "../company/company.service";
import {
  ProfessionalClosingListQueryDto,
  ProfessionalCommissionListQueryDto,
  ProfessionalCommissionSummaryQueryDto,
} from "./dto/find-professional-commissions-query.dto";
import { ProfessionalLinkService } from "./professional-link.service";

const pad = (value: number) => String(value).padStart(2, "0");

// Primeiro e último dia de "AAAA-MM", como a consulta da comissão os pede.
function monthRange(month: string): { from: string; to: string } {
  const [year, number] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(lastDay)}` };
}

// O fechamento sem quem o lançou ou o desfez: a lista de pessoas da clínica não
// é assunto dele. Montado campo a campo, para um campo novo não vazar sozinho.
function presentClosing(closing: ClosingItem) {
  return {
    id: closing.id,
    number: closing.number,
    cutoffDate: closing.cutoffDate,
    paidAt: closing.paidAt,
    paymentMethod: { name: closing.paymentMethod.name },
    commissionTotal: closing.commissionTotal,
    advanceTotal: closing.advanceTotal,
    paidAmount: closing.paidAmount,
    appointmentsCount: closing.appointmentsCount,
    cancelledAt: closing.cancelledAt,
  };
}

/**
 * Comissões do próprio profissional no app (docs/screens/app-profissional.md).
 * Reaproveita a consulta e os fechamentos que o ADMIN usa, sempre com o
 * profissional do vínculo, e entrega só o que ele deve ver: sem o quanto o
 * cliente pagou e sem os nomes de quem fechou. Só consulta.
 */
@Injectable()
export class ProfessionalCommissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
    private readonly access: CompanyAccessService,
    private readonly link: ProfessionalLinkService,
    private readonly commissions: CommissionService,
    private readonly closings: CommissionClosingService,
  ) {}

  /**
   * O mês: totais (pela data do atendimento) e o que está em aberto, que não
   * depende do mês: adiantado e a receber (comissão em aberto − adiantado).
   */
  async summary(
    user: AuthenticatedUser,
    { month }: ProfessionalCommissionSummaryQueryDto,
    now = new Date(),
  ) {
    const { professionalId, period } = await this.context(user, month, now);
    const [totals, professional] = await Promise.all([
      this.commissions.summary(
        { ...monthRange(period), professionalId },
        user.companyId,
        now,
      ),
      this.prisma.people.findFirst({
        where: { id: professionalId, type: PeopleType.PROFESSIONAL },
        select: { receivesCommission: true },
      }),
    ]);
    // O resumo traz um grupo por profissional; só o dele foi pedido.
    const own = totals.byProfessional[0];
    return {
      month: period,
      // Quem não recebe comissão (ex.: o dono que atende) vê o aviso na tela.
      receivesCommission: professional?.receivesCommission ?? true,
      count: own?.count ?? 0,
      base: own?.base ?? "0.00",
      amount: own?.amount ?? "0.00",
      advanced: totals.advanced,
      toPay: totals.toPay,
    };
  }

  /** Atendimento a atendimento do mês, do mais recente para o mais antigo. */
  async list(
    user: AuthenticatedUser,
    { page, limit, month }: ProfessionalCommissionListQueryDto,
    now = new Date(),
  ) {
    const { professionalId, period } = await this.context(user, month, now);
    const result = await this.commissions.list(
      { page, limit, ...monthRange(period), professionalId },
      user.companyId,
      now,
    );
    return {
      ...result,
      items: result.items.map((item) => ({
        id: item.id,
        startAt: item.appointment.startAt,
        clientName: item.appointment.client.name,
        serviceName: item.appointment.service.name,
        fromPackage: item.appointment.fromPackage,
        baseAmount: item.baseAmount,
        type: item.type,
        rate: item.rate,
        amount: item.amount,
        // Número do fechamento que a quitou; nulo = em aberto.
        closingNumber: item.closing?.number ?? null,
      })),
    };
  }

  /**
   * Os fechamentos dele, do número maior para o menor (os desfeitos, marcados),
   * paginados. Há um fechamento por período, então a lista inteira é pequena: a
   * página é cortada aqui, sem mexer na consulta do ADMIN.
   */
  async listClosings(
    user: AuthenticatedUser,
    { page, limit }: ProfessionalClosingListQueryDto,
  ) {
    const professionalId = await this.link.requireProfessionalId(user);
    await this.requireCommissions(user.companyId);
    const all = await this.closings.list(professionalId, user.companyId);
    return {
      items: all
        .slice((page - 1) * limit, page * limit)
        .map((item) => presentClosing(item)),
      total: all.length,
      page,
      limit,
    };
  }

  /**
   * O recibo de um fechamento dele, com o detalhamento. O de outro profissional
   * responde 404, como o inexistente.
   */
  async receipt(user: AuthenticatedUser, id: string) {
    const professionalId = await this.link.requireProfessionalId(user);
    await this.requireCommissions(user.companyId);
    const receipt = await this.closings.receipt(id, user.companyId);
    if (receipt.professional.id !== professionalId) {
      throw new NotFoundException("Fechamento não encontrado");
    }
    return {
      ...presentClosing(receipt),
      company: receipt.company,
      professional: {
        name: receipt.professional.name,
        document: receipt.professional.document,
      },
      details: receipt.details,
    };
  }

  // O profissional do vínculo, a funcionalidade liberada e o mês pedido (ou o atual).
  private async context(
    user: AuthenticatedUser,
    month: string | undefined,
    now: Date,
  ) {
    const professionalId = await this.link.requireProfessionalId(user);
    await this.requireCommissions(user.companyId);
    if (month) return { professionalId, period: month };
    const timeZone = await this.companyService.getTimeZone(user.companyId);
    const { year, month: current } = toZonedParts(now, timeZone);
    return { professionalId, period: `${year}-${pad(current)}` };
  }

  // Comissões é uma funcionalidade do plano: sem ela, a empresa não as usa.
  private async requireCommissions(companyId: string): Promise<void> {
    if (!(await this.access.can(companyId, "commissions", "view"))) {
      throw new ForbiddenException("A empresa não usa comissões");
    }
  }
}
