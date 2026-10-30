import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { BusinessHour } from "../../../generated/prisma/client";
import { WeekDay } from "../../../generated/prisma/enums";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import {
  formatTimeOfDay,
  parseTimeOfDay,
  WEEK_DAY_BY_INDEX,
} from "../../common/time/time-of-day";
import {
  minutesOfZonedDay,
  toZonedParts,
  weekDayIndexOf,
} from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { CreateBusinessHourDto } from "./dto/create-business-hour.dto";
import { FindBusinessHoursQueryDto } from "./dto/find-business-hours-query.dto";
import { UpdateBusinessHourDto } from "./dto/update-business-hour.dto";

// Colunas `time` vêm como Date na data de referência 1970-01-01 em UTC.
const minutesOfStoredTime = (value: Date) =>
  value.getUTCHours() * 60 + value.getUTCMinutes();

// Aceita tanto o PrismaService quanto o cliente de uma transação em andamento
// (ver o mesmo padrão em appointment.service.ts) — usado por createMany, que
// roda tudo dentro de uma única transação.
type PrismaClientLike = Pick<PrismaService, "businessHour">;

// Como a janela sai na API: horários em "HH:MM".
export interface BusinessHourResponse extends Omit<
  BusinessHour,
  "openAt" | "closeAt"
> {
  openAt: string;
  closeAt: string;
}

/**
 * Janelas de atendimento da empresa do usuário autenticado.
 *
 * Uma empresa pode ter mais de uma janela no mesmo dia da semana (ex.: manhã e
 * tarde), desde que não se sobreponham. Dias sem janela são considerados
 * fechados — exceto quando a empresa não cadastrou nenhuma janela, caso em que a
 * restrição não se aplica (ver ensureWithinBusinessHours).
 */
@Injectable()
export class BusinessHourService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
  ) {}

  async create(
    dto: CreateBusinessHourDto,
    companyId: string,
  ): Promise<BusinessHourResponse> {
    this.ensureOpensBeforeCloses(dto.openAt, dto.closeAt);
    await this.ensureDoesNotOverlap(dto, companyId);

    const created = await this.prisma.businessHour.create({
      data: {
        weekDay: dto.weekDay,
        openAt: parseTimeOfDay(dto.openAt),
        closeAt: parseTimeOfDay(dto.closeAt),
        companyId,
      },
    });

    return this.toResponse(created);
  }

  /**
   * Cria várias janelas de uma vez (ex.: toda a semana no setup inicial da
   * empresa). Tudo roda em uma única transação: se qualquer horário for
   * inválido ou conflitar — com um já existente ou com outro item do mesmo
   * lote — nada é criado.
   */
  async createMany(
    dtos: CreateBusinessHourDto[],
    companyId: string,
  ): Promise<BusinessHourResponse[]> {
    for (const dto of dtos) {
      this.ensureOpensBeforeCloses(dto.openAt, dto.closeAt);
    }
    this.ensureBatchDoesNotOverlapItself(dtos);

    const created = await this.prisma.$transaction(async (tx) => {
      const rows: BusinessHour[] = [];

      // Sequencial (não Promise.all): cada checagem de sobreposição precisa
      // enxergar as linhas já criadas pelos itens anteriores do mesmo lote.
      for (const dto of dtos) {
        await this.ensureDoesNotOverlap(dto, companyId, undefined, tx);

        rows.push(
          await tx.businessHour.create({
            data: {
              weekDay: dto.weekDay,
              openAt: parseTimeOfDay(dto.openAt),
              closeAt: parseTimeOfDay(dto.closeAt),
              companyId,
            },
          }),
        );
      }

      return rows;
    });

    return created.map((item) => this.toResponse(item));
  }

  async findAll(
    { page, limit, weekDay }: FindBusinessHoursQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<BusinessHourResponse>> {
    const where = { companyId, deletedAt: null, weekDay };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.businessHour.findMany({
        where,
        orderBy: [{ weekDay: "asc" }, { openAt: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.businessHour.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toResponse(item)),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string, companyId: string): Promise<BusinessHourResponse> {
    return this.toResponse(await this.findEntity(id, companyId));
  }

  async update(
    id: string,
    dto: UpdateBusinessHourDto,
    companyId: string,
  ): Promise<BusinessHourResponse> {
    const current = await this.findEntity(id, companyId);

    // Estado final da janela, considerando o que veio no PATCH.
    const weekDay = dto.weekDay ?? current.weekDay;
    const openAt = dto.openAt ?? formatTimeOfDay(current.openAt);
    const closeAt = dto.closeAt ?? formatTimeOfDay(current.closeAt);

    this.ensureOpensBeforeCloses(openAt, closeAt);
    await this.ensureDoesNotOverlap(
      { weekDay, openAt, closeAt },
      companyId,
      id,
    );

    const updated = await this.prisma.businessHour.update({
      where: { id },
      data: {
        weekDay,
        openAt: parseTimeOfDay(openAt),
        closeAt: parseTimeOfDay(closeAt),
        updatedAt: new Date(),
      },
    });

    return this.toResponse(updated);
  }

  async remove(id: string, companyId: string): Promise<void> {
    await this.findEntity(id, companyId);

    const now = new Date();
    await this.prisma.businessHour.update({
      where: { id },
      data: { deletedAt: now, updatedAt: now },
    });
  }

  /**
   * Diz se o intervalo cabe inteiro em uma janela de atendimento, sem recusar.
   * O agendamento avulso usa a resposta para decidir entre recusar e marcar como
   * encaixe (overBooking).
   *
   * Empresa sem nenhuma janela cadastrada não restringe horários: a regra passa a
   * valer a partir do primeiro cadastro, para não travar quem ainda não configurou
   * a agenda. Dia sem janela é dia fechado.
   *
   * O dia da semana e os horários são lidos no fuso da empresa: uma janela
   * "09:00–18:00" vale no relógio dela, não em UTC.
   */
  async isWithinBusinessHours(
    companyId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<boolean> {
    const total = await this.prisma.businessHour.count({
      where: { companyId, deletedAt: null },
    });
    if (total === 0) {
      return true;
    }

    const timeZone = await this.companyService.getTimeZone(companyId);
    const weekDay =
      WEEK_DAY_BY_INDEX[weekDayIndexOf(toZonedParts(startAt, timeZone))];

    return this.fitsWindowOf(
      companyId,
      weekDay,
      minutesOfZonedDay(startAt, timeZone),
      minutesOfZonedDay(endAt, timeZone),
    );
  }

  /**
   * Mesma conferência para um horário semanal, sem data (ex.: o horário de uma
   * turma fixa): `start` e `end` em minutos desde a meia-noite, no relógio da
   * empresa. Sem nenhuma janela cadastrada, não há restrição.
   */
  async isWeeklySlotWithinBusinessHours(
    companyId: string,
    weekDay: WeekDay,
    start: number,
    end: number,
  ): Promise<boolean> {
    const total = await this.prisma.businessHour.count({
      where: { companyId, deletedAt: null },
    });
    if (total === 0) {
      return true;
    }

    return this.fitsWindowOf(companyId, weekDay, start, end);
  }

  // O intervalo cabe inteiro em uma das janelas do dia da semana.
  private async fitsWindowOf(
    companyId: string,
    weekDay: WeekDay,
    start: number,
    end: number,
  ): Promise<boolean> {
    const windows = await this.prisma.businessHour.findMany({
      where: { companyId, deletedAt: null, weekDay },
      select: { openAt: true, closeAt: true },
    });

    // O fim precisa cair no mesmo dia: um atendimento que vira o dia não cabe
    // em nenhuma janela.
    return (
      end > start &&
      windows.some(
        (window) =>
          start >= minutesOfStoredTime(window.openAt) &&
          end <= minutesOfStoredTime(window.closeAt),
      )
    );
  }

  /**
   * Garante que o intervalo cabe inteiro em uma janela de atendimento. Usado
   * onde não há encaixe: cada ocorrência gerada por uma recorrência (ou plano) e
   * o remanejamento delas.
   */
  async ensureWithinBusinessHours(
    companyId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<void> {
    if (!(await this.isWithinBusinessHours(companyId, startAt, endAt))) {
      throw new BadRequestException(
        "O horário está fora do funcionamento da empresa",
      );
    }
  }

  private async findEntity(
    id: string,
    companyId: string,
  ): Promise<BusinessHour> {
    const businessHour = await this.prisma.businessHour.findFirst({
      where: { id, companyId, deletedAt: null },
    });

    if (!businessHour) {
      throw new NotFoundException("Horário de funcionamento não encontrado");
    }

    return businessHour;
  }

  private ensureOpensBeforeCloses(openAt: string, closeAt: string) {
    if (closeAt <= openAt) {
      throw new BadRequestException("closeAt deve ser posterior a openAt");
    }
  }

  // Duas janelas do mesmo dia não podem se sobrepor; encostar (fim == início) é permitido.
  private async ensureDoesNotOverlap(
    { weekDay, openAt, closeAt }: CreateBusinessHourDto,
    companyId: string,
    ignoreId?: string,
    db: PrismaClientLike = this.prisma,
  ) {
    const overlap = await db.businessHour.findFirst({
      where: {
        companyId,
        weekDay,
        deletedAt: null,
        id: ignoreId ? { not: ignoreId } : undefined,
        openAt: { lt: parseTimeOfDay(closeAt) },
        closeAt: { gt: parseTimeOfDay(openAt) },
      },
      select: { id: true },
    });

    if (overlap) {
      throw new ConflictException(
        "Já existe uma janela de atendimento neste intervalo",
      );
    }
  }

  /**
   * Mesma regra de sobreposição de ensureDoesNotOverlap, mas comparando os
   * itens do lote entre si (ainda não existem no banco, então uma consulta
   * não os enxergaria). Mesmo algoritmo usado em
   * RecurringAppointmentService.ensureDaysAreValid: agrupa por dia da semana,
   * ordena por horário de início e compara só vizinhos.
   */
  private ensureBatchDoesNotOverlapItself(dtos: CreateBusinessHourDto[]) {
    const byWeekDay = new Map<WeekDay, CreateBusinessHourDto[]>();
    for (const dto of dtos) {
      byWeekDay.set(dto.weekDay, [...(byWeekDay.get(dto.weekDay) ?? []), dto]);
    }

    for (const [weekDay, sameDay] of byWeekDay) {
      const ordered = [...sameDay].sort((a, b) =>
        a.openAt.localeCompare(b.openAt),
      );

      const overlaps = ordered.some(
        (dto, index) => index > 0 && dto.openAt < ordered[index - 1].closeAt,
      );

      if (overlaps) {
        throw new ConflictException(
          `Há horários sobrepostos em ${weekDay} no mesmo lote`,
        );
      }
    }
  }

  private toResponse(businessHour: BusinessHour): BusinessHourResponse {
    return {
      ...businessHour,
      openAt: formatTimeOfDay(businessHour.openAt),
      closeAt: formatTimeOfDay(businessHour.closeAt),
    };
  }
}
