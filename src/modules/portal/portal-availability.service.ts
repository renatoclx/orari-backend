import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AppointmentStatus, WeekDay } from "../../../generated/prisma/enums";
import {
  formatTimeOfDay,
  WEEK_DAY_BY_INDEX,
} from "../../common/time/time-of-day";
import {
  toZonedParts,
  weekDayIndexOf,
  zonedToUtc,
  type ZonedParts,
} from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import {
  availableStarts,
  DAY_MINUTES,
  daysBetween,
  minutesOf,
  timeOf,
  type Interval,
} from "./portal-availability";
import type { PortalCompany } from "./portal-company.service";

export interface PortalSlot {
  // Horário no relógio da clínica ("09:30").
  time: string;
  // O mesmo instante em UTC, pronto para o agendamento.
  startAt: string;
}

/**
 * Horários livres de um serviço com um profissional, num dia, para o portal.
 * Fora do período que a clínica permite (passado ou além dos dias à frente),
 * a lista vem vazia. Sem horário de funcionamento no dia, também: no portal,
 * a clínica precisa ter as janelas cadastradas.
 */
@Injectable()
export class PortalAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async findSlots(
    company: PortalCompany,
    serviceId: string,
    professionalId: string,
    date: string,
    now = new Date(),
  ): Promise<PortalSlot[]> {
    const day = this.parseDate(date);
    const today = toZonedParts(now, company.timezone);
    const ahead = daysBetween(today, day);
    if (ahead < 0 || ahead > company.rules.maxDaysAhead) return [];

    const duration = await this.durationOf(
      company.id,
      serviceId,
      professionalId,
    );
    const weekDay: WeekDay =
      WEEK_DAY_BY_INDEX[weekDayIndexOf({ ...day, hours: 0, minutes: 0 })];
    const dayStart = zonedToUtc(
      { ...day, hours: 0, minutes: 0 },
      company.timezone,
    );
    const nextDay = new Date(Date.UTC(day.year, day.month - 1, day.day + 1));
    const dayEnd = zonedToUtc(
      {
        year: nextDay.getUTCFullYear(),
        month: nextDay.getUTCMonth() + 1,
        day: nextDay.getUTCDate(),
        hours: 0,
        minutes: 0,
      },
      company.timezone,
    );

    const [windows, busy] = await Promise.all([
      this.windowsOf(company.id, weekDay),
      this.busyOf(company, professionalId, weekDay, dayStart, dayEnd),
    ]);

    // Antecedência mínima: o primeiro minuto deste dia ainda permitido.
    const earliest = new Date(
      now.getTime() + company.rules.minAdvanceMinutes * 60_000,
    );
    const notBefore =
      earliest <= dayStart
        ? 0
        : earliest >= dayEnd
          ? DAY_MINUTES
          : this.minutesInDay(earliest, dayStart);

    return availableStarts({ windows, busy, duration, notBefore }).map(
      (minutes) => ({
        time: timeOf(minutes),
        startAt: zonedToUtc(
          { ...day, hours: Math.floor(minutes / 60), minutes: minutes % 60 },
          company.timezone,
        ).toISOString(),
      }),
    );
  }

  private parseDate(date: string): Omit<ZonedParts, "hours" | "minutes"> {
    const [year, month, day] = date.split("-").map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
      throw new BadRequestException("Data inválida");
    }
    return { year, month, day };
  }

  // Serviço ativo da clínica, atendido por este profissional ativo (o que a vitrine mostra).
  private async durationOf(
    companyId: string,
    serviceId: string,
    professionalId: string,
  ): Promise<number> {
    const link = await this.prisma.serviceProfessional.findFirst({
      where: {
        serviceId,
        peopleId: professionalId,
        service: { companyId, isActive: true, deletedAt: null },
        people: { companyId, type: "PROFESSIONAL", deletedAt: null },
      },
      select: { service: { select: { duration: true } } },
    });
    if (!link) {
      throw new NotFoundException(
        "Serviço ou profissional indisponível no portal",
      );
    }
    return link.service.duration;
  }

  private async windowsOf(
    companyId: string,
    weekDay: WeekDay,
  ): Promise<Interval[]> {
    const hours = await this.prisma.businessHour.findMany({
      where: { companyId, weekDay, deletedAt: null },
      select: { openAt: true, closeAt: true },
    });
    return hours.map((hour) => ({
      start: minutesOf(formatTimeOfDay(hour.openAt)),
      end: minutesOf(formatTimeOfDay(hour.closeAt)),
    }));
  }

  /**
   * Compromissos do profissional no dia: agendamentos não cancelados (inclusive
   * os de turma), os horários das turmas fixas dele, mesmo sem alunos (o
   * cliente do portal não ocupa o horário de uma turma), e os horários
   * bloqueados na agenda da clínica.
   */
  private async busyOf(
    company: PortalCompany,
    professionalId: string,
    weekDay: WeekDay,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<Interval[]> {
    const [appointments, classDays, blocks] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          companyId: company.id,
          professionalId,
          status: { not: AppointmentStatus.CANCELLED },
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
        },
        select: { startAt: true, endAt: true },
      }),
      this.prisma.classGroupDay.findMany({
        where: {
          weekDay,
          classGroup: { companyId: company.id, professionalId, isActive: true },
        },
        select: {
          startTime: true,
          classGroup: { select: { service: { select: { duration: true } } } },
        },
      }),
      // Horários bloqueados na agenda da clínica (de todos os profissionais).
      this.prisma.agendaBlock.findMany({
        where: {
          companyId: company.id,
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
        },
        select: { startAt: true, endAt: true },
      }),
    ]);

    return [
      ...[...appointments, ...blocks].map(({ startAt, endAt }) => ({
        start: startAt <= dayStart ? 0 : this.minutesInDay(startAt, dayStart),
        end: endAt >= dayEnd ? DAY_MINUTES : this.minutesInDay(endAt, dayStart),
      })),
      ...classDays.map((classDay) => {
        const start = minutesOf(formatTimeOfDay(classDay.startTime));
        return { start, end: start + classDay.classGroup.service.duration };
      }),
    ];
  }

  // Minutos desde o começo do dia da clínica (vale também nos dias de horário de verão).
  private minutesInDay(instant: Date, dayStart: Date): number {
    return Math.round((instant.getTime() - dayStart.getTime()) / 60_000);
  }
}
