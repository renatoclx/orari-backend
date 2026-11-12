import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { PeopleType } from "../../../generated/prisma/enums";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { toZonedParts, zonedToUtc } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";

type Day = { year: number; month: number; day: number };

// Um profissional atende poucas dezenas de vezes por dia; o teto só protege a
// resposta de um dado anormal.
const DAY_LIMIT = 200;

// Só o que a tela do app mostra. Sem pagamento, comissão, anamnese nem
// contato do cliente: esses dados não saem por esta rota.
const agendaSelect = {
  id: true,
  startAt: true,
  endAt: true,
  status: true,
  note: true,
  overBooking: true,
  client: { select: { id: true, name: true } },
  service: {
    select: { id: true, name: true, color: true, duration: true, price: true },
  },
  recurringAppointment: { select: { clientPlanId: true } },
  classSession: { select: { id: true, capacity: true, cancelledAt: true } },
} as const;

const pad = (value: number) => String(value).padStart(2, "0");
const formatDay = ({ year, month, day }: Day) =>
  `${year}-${pad(month)}-${pad(day)}`;

// Lê AAAA-MM-DD e recusa data que não existe (ex.: 2026-02-31).
function parseDay(value: string): Day {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException("Dia inexistente");
  }
  return { year, month, day };
}

// O dia seguinte no calendário (fim do dia, excluído).
function nextDay({ year, month, day }: Day): Day {
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/**
 * Consultas do app do profissional (docs/screens/app-profissional.md). Tudo
 * parte do usuário logado: o profissional vem do vínculo dele, nunca de um
 * parâmetro, então ninguém vê a agenda de outro mudando a URL.
 */
@Injectable()
export class ProfessionalAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
  ) {}

  /**
   * Agenda de um dia do próprio profissional: os atendimentos (cancelados e
   * faltas incluídos, como na agenda da clínica) e os bloqueios do dia, que
   * valem para a empresa toda.
   */
  async findAgenda(
    user: AuthenticatedUser,
    dayInput?: string,
    now = new Date(),
  ) {
    const professionalId = await this.requireProfessionalId(user);
    const timeZone = await this.companyService.getTimeZone(user.companyId);

    const day = dayInput ? parseDay(dayInput) : toZonedParts(now, timeZone);
    const start = zonedToUtc({ ...day, hours: 0, minutes: 0 }, timeZone);
    const end = zonedToUtc({ ...nextDay(day), hours: 0, minutes: 0 }, timeZone);

    const [appointments, blocks] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          companyId: user.companyId,
          professionalId,
          startAt: { gte: start, lt: end },
        },
        // O id desempata horários iguais, para a ordem não mudar entre chamadas.
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
        take: DAY_LIMIT,
        select: agendaSelect,
      }),
      this.prisma.agendaBlock.findMany({
        where: {
          companyId: user.companyId,
          endAt: { gt: start },
          startAt: { lt: end },
        },
        orderBy: { startAt: "asc" },
        select: { id: true, startAt: true, endAt: true },
      }),
    ]);

    return {
      day: formatDay(day),
      appointments: appointments.map(
        ({ recurringAppointment, service, ...appointment }) => ({
          ...appointment,
          service: { ...service, price: service.price?.toNumber() ?? null },
          // Origem: sessão de pacote, de recorrência ou avulso.
          recurrence: recurringAppointment
            ? { isPackage: recurringAppointment.clientPlanId !== null }
            : null,
        }),
      ),
      blocks,
    };
  }

  /**
   * O profissional do usuário logado. Cadastro inativado suspende o acesso
   * (como o /auth/me, que o mostra sem vínculo).
   */
  private async requireProfessionalId(
    user: AuthenticatedUser,
  ): Promise<string> {
    const found = await this.prisma.user.findFirst({
      where: { id: user.id, companyId: user.companyId, deletedAt: null },
      select: { people: { select: { id: true, type: true, deletedAt: true } } },
    });
    const person = found?.people;
    if (
      !person ||
      person.deletedAt ||
      person.type !== PeopleType.PROFESSIONAL
    ) {
      throw new ForbiddenException("O cadastro de profissional está inativo");
    }
    return person.id;
  }
}
