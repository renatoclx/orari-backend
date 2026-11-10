import { Injectable } from "@nestjs/common";
import {
  AppointmentStatus,
  PaymentStatus,
} from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { periodOf } from "../../common/time/report-period";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import type { RankingSort, RankingsQueryDto } from "./dto/rankings-query.dto";

// Pagamento que conta como faturado: recebido ou a receber.
const BILLED: PaymentStatus[] = [PaymentStatus.PAID, PaymentStatus.PENDING];

/** Atendimento concluído, com o valor do pagamento próprio (null sem ele). */
export interface RankedAppointment {
  startAt: Date;
  client: { id: string; name: string };
  professional: { id: string; name: string };
  service: { id: string; name: string };
  /** null: sem pagamento próprio (ex.: sessão de pacote). */
  amount: Decimal | null;
}

/** Pacote contratado no período: o cliente e o valor cobrado. */
export interface RankedContract {
  client: { id: string; name: string };
  amount: Decimal;
}

export interface RankingRow {
  id: string;
  name: string;
  completed: number;
  amount: string;
  /** Faturado ÷ concluídos com pagamento; null sem nenhum. */
  average: string | null;
}

export interface Rankings {
  summary: {
    amount: string;
    completed: number;
    average: string | null;
    /** Pacotes contratados no período (entram só no ranking de clientes). */
    packages: { count: number; amount: string };
  };
  /** `share`: parte do faturado dos atendimentos, de 0 a 1. */
  services: (RankingRow & { share: number })[];
  professionals: (RankingRow & { clients: number })[];
  /** `amount` soma atendimentos e pacotes; `packages` é a parte dos pacotes. */
  clients: (RankingRow & { packages: string; lastVisit: Date | null })[];
}

// Acumulador de uma linha (valores em Decimal até o fim).
type Acc = {
  id: string;
  name: string;
  completed: number;
  paid: number;
  amount: Decimal;
};

const newAcc = ({ id, name }: { id: string; name: string }): Acc => ({
  id,
  name,
  completed: 0,
  paid: 0,
  amount: new Decimal(0),
});

const add = (acc: Acc, amount: Decimal | null) => {
  acc.completed += 1;
  if (amount !== null) {
    acc.paid += 1;
    acc.amount = acc.amount.plus(amount);
  }
};

const toRow = ({ id, name, completed, paid, amount }: Acc): RankingRow => ({
  id,
  name,
  completed,
  amount: amount.toFixed(2),
  average: paid > 0 ? amount.div(paid).toFixed(2) : null,
});

// Pega (ou cria) o acumulador da chave.
function accFor<T extends Acc>(
  map: Map<string, T>,
  key: { id: string; name: string },
  create: () => T,
): T {
  const current = map.get(key.id);
  if (current) return current;
  const created = create();
  map.set(key.id, created);
  return created;
}

/** Faturado (ou quantidade) do maior para o menor; empate pelo nome. */
function sorter(sort: RankingSort) {
  return (a: RankingRow, b: RankingRow) =>
    (sort === "count"
      ? b.completed - a.completed || new Decimal(b.amount).comparedTo(a.amount)
      : new Decimal(b.amount).comparedTo(a.amount) ||
        b.completed - a.completed) || a.name.localeCompare(b.name);
}

/**
 * Os três rankings a partir dos concluídos e dos pacotes do período (função
 * pura). A sessão de pacote conta na quantidade, sem valor; o pacote
 * contratado soma só no cliente.
 */
export function buildRankings(
  appointments: RankedAppointment[],
  contracts: RankedContract[],
  sort: RankingSort,
): Rankings {
  const total = newAcc({ id: "", name: "" });
  const services = new Map<string, Acc>();
  const professionals = new Map<string, Acc & { clientIds: Set<string> }>();
  const clients = new Map<
    string,
    Acc & { packages: Decimal; lastVisit: Date | null }
  >();
  const newClient = (client: { id: string; name: string }) => ({
    ...newAcc(client),
    packages: new Decimal(0),
    lastVisit: null as Date | null,
  });

  for (const appointment of appointments) {
    add(total, appointment.amount);
    add(
      accFor(services, appointment.service, () => newAcc(appointment.service)),
      appointment.amount,
    );
    const professional = accFor(
      professionals,
      appointment.professional,
      () => ({
        ...newAcc(appointment.professional),
        clientIds: new Set<string>(),
      }),
    );
    add(professional, appointment.amount);
    professional.clientIds.add(appointment.client.id);

    const client = accFor(clients, appointment.client, () =>
      newClient(appointment.client),
    );
    add(client, appointment.amount);
    if (!client.lastVisit || appointment.startAt > client.lastVisit) {
      client.lastVisit = appointment.startAt;
    }
  }

  let packagesAmount = new Decimal(0);
  for (const contract of contracts) {
    packagesAmount = packagesAmount.plus(contract.amount);
    const client = accFor(clients, contract.client, () =>
      newClient(contract.client),
    );
    client.packages = client.packages.plus(contract.amount);
  }

  const order = sorter(sort);
  return {
    summary: {
      amount: total.amount.toFixed(2),
      completed: total.completed,
      average: toRow(total).average,
      packages: { count: contracts.length, amount: packagesAmount.toFixed(2) },
    },
    services: [...services.values()]
      .map((acc) => ({
        ...toRow(acc),
        share: total.amount.isZero()
          ? 0
          : acc.amount.div(total.amount).toNumber(),
      }))
      .sort(order),
    professionals: [...professionals.values()]
      .map((acc) => ({ ...toRow(acc), clients: acc.clientIds.size }))
      .sort(order),
    // Pacote entra no faturado do cliente, mas não no ticket médio (que é
    // por atendimento).
    clients: [...clients.values()]
      .map((acc) => ({
        ...toRow(acc),
        amount: acc.amount.plus(acc.packages).toFixed(2),
        packages: acc.packages.toFixed(2),
        lastVisit: acc.lastVisit,
      }))
      .sort(order),
  };
}

/**
 * Rankings de serviços, profissionais e clientes (ver docs/business-rules.md,
 * "Rankings"). Só leitura.
 */
@Injectable()
export class RankingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
  ) {}

  async rankings(
    { from, to, sort = "amount" }: RankingsQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<Rankings> {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const period = periodOf(from, to, timeZone, now);
    const inPeriod = { gte: period.start, lt: period.end };
    const person = { select: { id: true, name: true } } as const;

    const [appointments, contracts] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          companyId,
          status: AppointmentStatus.COMPLETED,
          startAt: inPeriod,
        },
        select: {
          startAt: true,
          client: person,
          professional: person,
          service: person,
          payment: { select: { amount: true, status: true, deletedAt: true } },
        },
      }),
      this.prisma.clientPlan.findMany({
        where: { companyId, createdAt: inPeriod },
        select: {
          client: person,
          payments: {
            where: { deletedAt: null, status: { in: BILLED } },
            select: { amount: true },
          },
        },
      }),
    ]);

    return buildRankings(
      appointments.map(({ payment, ...appointment }) => ({
        ...appointment,
        // Só o pagamento ativo e não cancelado é faturado.
        amount:
          payment &&
          payment.deletedAt === null &&
          BILLED.includes(payment.status)
            ? payment.amount
            : null,
      })),
      contracts.map((contract) => ({
        client: contract.client,
        amount: contract.payments.reduce(
          (sum, payment) => sum.plus(payment.amount),
          new Decimal(0),
        ),
      })),
      sort,
    );
  }
}
