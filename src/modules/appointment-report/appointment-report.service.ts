import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AppointmentSource,
  AppointmentStatus,
  PeopleType,
} from "../../../generated/prisma/enums";
import {
  periodOf,
  seriesFrame,
  type Period,
} from "../../common/time/report-period";
import { toZonedParts } from "../../common/time/time-zone";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import type { AppointmentReportQueryDto } from "./dto/appointment-report-query.dto";

const MINUTE_MS = 60 * 1000;

// Ainda sem desfecho: conta no total e em "a acontecer".
const OPEN_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
];

/** Contagens de um profissional ou serviço. `total` não conta os cancelados. */
export interface AppointmentBreakdown {
  id: string;
  name: string;
  total: number;
  completed: number;
  noShow: number;
  cancelled: number;
}

export interface AppointmentReportPoint {
  /** Primeiro dia do intervalo, AAAA-MM-DD no fuso da empresa. */
  date: string;
  completed: number;
  noShow: number;
  cancelled: number;
  open: number;
}

export interface AppointmentReport {
  total: number;
  open: number;
  completed: number;
  noShow: number;
  cancelled: number;
  fromPortal: number;
  /** Faltas ÷ (concluídos + faltas), de 0 a 1; null sem nenhum dos dois. */
  noShowRate: number | null;
  /** Cancelados ÷ todos (com os cancelados), de 0 a 1; null sem nenhum. */
  cancelRate: number | null;
  series: { unit: "day" | "week"; points: AppointmentReportPoint[] };
  /** Só as células com agendamento; weekDay 0 = domingo, hora de início local. */
  peak: { weekDay: number; hour: number; count: number }[];
  byProfessional: AppointmentBreakdown[];
  byService: (AppointmentBreakdown & { minutes: number })[];
}

/** O que o relatório lê de cada agendamento. */
export interface ReportAppointment {
  status: AppointmentStatus;
  startAt: Date;
  endAt: Date;
  source: AppointmentSource;
  professional: { id: string; name: string };
  service: { id: string; name: string };
}

const ratio = (part: number, whole: number) =>
  whole > 0 ? part / whole : null;

// Maior total primeiro; empate pelo nome.
const byTotal = (a: AppointmentBreakdown, b: AppointmentBreakdown) =>
  b.total - a.total || a.name.localeCompare(b.name);

/**
 * Os números do relatório a partir dos agendamentos do período (função pura).
 * Cancelado não entra no total, no pico nem na duração; entra só na própria
 * contagem e na taxa de cancelamento. Na turma, cada aluno é um agendamento.
 */
export function summarizeAppointments(
  rows: ReportAppointment[],
  period: Period,
  timeZone: string,
): AppointmentReport {
  const frame = seriesFrame(period, timeZone);
  const points: AppointmentReportPoint[] = frame.dates.map((date) => ({
    date,
    completed: 0,
    noShow: 0,
    cancelled: 0,
    open: 0,
  }));
  const peak = new Map<
    string,
    { weekDay: number; hour: number; count: number }
  >();
  const professionals = new Map<string, AppointmentBreakdown>();
  const services = new Map<
    string,
    AppointmentBreakdown & { minutes: number }
  >();
  const counts = {
    completed: 0,
    noShow: 0,
    cancelled: 0,
    open: 0,
    fromPortal: 0,
  };

  for (const row of rows) {
    const professional =
      professionals.get(row.professional.id) ??
      professionals
        .set(row.professional.id, {
          ...row.professional,
          total: 0,
          completed: 0,
          noShow: 0,
          cancelled: 0,
        })
        .get(row.professional.id)!;
    const service =
      services.get(row.service.id) ??
      services
        .set(row.service.id, {
          ...row.service,
          total: 0,
          completed: 0,
          noShow: 0,
          cancelled: 0,
          minutes: 0,
        })
        .get(row.service.id)!;
    const point = points[frame.indexOf(row.startAt)];

    // Em qual contagem o agendamento entra (a chave é igual nos três lugares).
    const key =
      row.status === AppointmentStatus.CANCELLED
        ? "cancelled"
        : row.status === AppointmentStatus.NO_SHOW
          ? "noShow"
          : row.status === AppointmentStatus.COMPLETED
            ? "completed"
            : OPEN_STATUSES.includes(row.status)
              ? "open"
              : null;
    if (key === null) continue;
    counts[key] += 1;
    if (point) point[key] += 1;
    if (key !== "open") {
      professional[key] += 1;
      service[key] += 1;
    }
    if (key === "cancelled") continue;

    professional.total += 1;
    service.total += 1;
    service.minutes += Math.round(
      (row.endAt.getTime() - row.startAt.getTime()) / MINUTE_MS,
    );
    if (row.source === AppointmentSource.PORTAL) counts.fromPortal += 1;

    const { year, month, day, hours } = toZonedParts(row.startAt, timeZone);
    const weekDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const cell = `${weekDay}-${hours}`;
    const current = peak.get(cell);
    if (current) current.count += 1;
    else peak.set(cell, { weekDay, hour: hours, count: 1 });
  }

  const total = counts.completed + counts.noShow + counts.open;
  return {
    total,
    open: counts.open,
    completed: counts.completed,
    noShow: counts.noShow,
    cancelled: counts.cancelled,
    fromPortal: counts.fromPortal,
    noShowRate: ratio(counts.noShow, counts.completed + counts.noShow),
    cancelRate: ratio(counts.cancelled, total + counts.cancelled),
    series: { unit: frame.unit, points },
    peak: [...peak.values()].sort(
      (a, b) => a.weekDay - b.weekDay || a.hour - b.hour,
    ),
    byProfessional: [...professionals.values()].sort(byTotal),
    byService: [...services.values()].sort(byTotal),
  };
}

/**
 * Relatório de agendamentos (ver docs/business-rules/relatorios.md, "Relatório de
 * agendamentos"). Só leitura, pelo início do agendamento no período.
 */
@Injectable()
export class AppointmentReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
  ) {}

  async report(
    { professionalId, from, to }: AppointmentReportQueryDto,
    companyId: string,
    now = new Date(),
  ): Promise<AppointmentReport> {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const period = periodOf(from, to, timeZone, now);

    if (professionalId) {
      const professional = await this.prisma.people.findFirst({
        where: { id: professionalId, companyId, type: PeopleType.PROFESSIONAL },
        select: { id: true },
      });
      if (!professional) {
        throw new NotFoundException("Profissional não encontrado");
      }
    }

    const rows = await this.prisma.appointment.findMany({
      where: {
        companyId,
        professionalId,
        startAt: { gte: period.start, lt: period.end },
      },
      select: {
        status: true,
        startAt: true,
        endAt: true,
        source: true,
        professional: { select: { id: true, name: true } },
        service: { select: { id: true, name: true } },
      },
    });

    return summarizeAppointments(rows, period, timeZone);
  }
}
