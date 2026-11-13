import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { AutoMessageService } from "../auto-message/auto-message.service";
import type { NotificationDispatcher } from "./notification-dispatcher.service";
import { ProfessionalNotifierJob } from "./professional-notifier.job";

// 16/11/2026 às 08:00 em São Paulo (UTC-3).
const NOW_REMINDER = new Date("2026-11-16T11:00:00.000Z");
// 7h40 em São Paulo.
const NOW_SUMMARY = new Date("2026-11-16T10:40:00.000Z");

const settings = (kind: string, body: string, enabled = true) => ({
  kind,
  enabled,
  body,
  reminderOffsets: [],
  missYouDays: null,
});

describe("ProfessionalNotifierJob", () => {
  const prismaMock = {
    companyFeatureAccess: { findMany: vi.fn() },
    company: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    appointment: { findMany: vi.fn() },
  };
  const autoMock = { findOne: vi.fn() };
  const dispatcherMock = { notify: vi.fn() };
  const job = new ProfessionalNotifierJob(
    prismaMock as unknown as PrismaService,
    autoMock as unknown as AutoMessageService,
    dispatcherMock as unknown as NotificationDispatcher,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.companyFeatureAccess.findMany.mockResolvedValue([
      { companyId: "company-1" },
    ]);
    prismaMock.company.findMany.mockResolvedValue([
      {
        id: "company-1",
        fantasyName: "Studio Aurora",
        corporateReason: "Aurora LTDA",
        timezone: "America/Sao_Paulo",
      },
    ]);
    prismaMock.user.findMany.mockResolvedValue([
      { id: "user-1", name: "Camila Rocha", peopleId: "pro-1" },
    ]);
    dispatcherMock.notify.mockResolvedValue(1);
  });

  describe("lembrete (30 minutos antes)", () => {
    beforeEach(() => {
      autoMock.findOne.mockResolvedValue(
        settings("PROFESSIONAL_REMINDER", "Atendimento: {servico}, às {hora}."),
      );
    });

    it("só olha clínicas ativas com Mensagens no plano", async () => {
      prismaMock.appointment.findMany.mockResolvedValue([]);
      await job.reminders(NOW_REMINDER);
      expect(prismaMock.companyFeatureAccess.findMany).toHaveBeenCalledWith({
        where: { feature: "messages", canView: true },
        select: { companyId: true },
      });
      expect(prismaMock.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["company-1"] }, isActive: true },
        }),
      );
    });

    it("procura o que começa em 30 min (com 15 de tolerância), agendado ou confirmado, dos profissionais com app", async () => {
      prismaMock.appointment.findMany.mockResolvedValue([]);
      await job.reminders(NOW_REMINDER);
      const [[args]] = prismaMock.appointment.findMany.mock.calls as [
        { where: Record<string, unknown> },
      ][];
      expect(args.where).toMatchObject({
        companyId: "company-1",
        professionalId: { in: ["pro-1"] },
        status: { in: ["SCHEDULED", "CONFIRMED"] },
        startAt: {
          // início entre 08:15 e 08:30 (agora + 15 até agora + 30 min).
          gt: new Date("2026-11-16T11:15:00.000Z"),
          lte: new Date("2026-11-16T11:30:00.000Z"),
        },
      });
    });

    it("avisa com a chave do atendimento e o texto sem o nome do cliente", async () => {
      prismaMock.appointment.findMany.mockResolvedValue([
        {
          id: "a1",
          startAt: new Date("2026-11-16T11:30:00.000Z"),
          professionalId: "pro-1",
          classSessionId: null,
          service: { name: "Corte" },
        },
      ]);
      const sent = await job.reminders(NOW_REMINDER);
      expect(sent).toBe(1);
      expect(dispatcherMock.notify).toHaveBeenCalledWith({
        companyId: "company-1",
        userIds: ["user-1"],
        category: "REMINDER",
        title: "Próximo atendimento",
        body: "Atendimento: Corte, às 08:30.",
        url: "/app/agenda?dia=2026-11-16",
        dedupeKey: "reminder:appointment:a1",
      });
    });

    it("a turma gera um lembrete só por sessão", async () => {
      const row = (id: string) => ({
        id,
        startAt: new Date("2026-11-16T11:30:00.000Z"),
        professionalId: "pro-1",
        classSessionId: "s1",
        service: { name: "Pilates" },
      });
      prismaMock.appointment.findMany.mockResolvedValue([
        row("a1"),
        row("a2"),
        row("a3"),
      ]);
      await job.reminders(NOW_REMINDER);
      expect(dispatcherMock.notify).toHaveBeenCalledTimes(1);
      expect(dispatcherMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({ dedupeKey: "reminder:class-session:s1" }),
      );
    });

    it("situação desligada em Mensagens: não procura nada", async () => {
      autoMock.findOne.mockResolvedValue(
        settings("PROFESSIONAL_REMINDER", "x", false),
      );
      await job.reminders(NOW_REMINDER);
      expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
      expect(dispatcherMock.notify).not.toHaveBeenCalled();
    });

    it("sem profissional com app na clínica: não procura nada", async () => {
      prismaMock.user.findMany.mockResolvedValue([]);
      await job.reminders(NOW_REMINDER);
      expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
    });

    it("falha em uma rodada não derruba o job", async () => {
      prismaMock.company.findMany.mockRejectedValue(new Error("banco"));
      await expect(job.reminders(NOW_REMINDER)).resolves.toBe(0);
    });
  });

  describe("resumo da manhã", () => {
    const appointment = (
      id: string,
      hour: string,
      overrides: Record<string, unknown> = {},
    ) => ({
      id,
      startAt: new Date(`2026-11-16T${hour}:00.000Z`),
      endAt: new Date(`2026-11-16T${hour}:00.000Z`),
      status: "SCHEDULED",
      classSessionId: null,
      clientId: `c-${id}`,
      professionalId: "pro-1",
      client: { name: "Ana" },
      service: { name: "Corte" },
      ...overrides,
    });

    beforeEach(() => {
      autoMock.findOne.mockResolvedValue(
        settings(
          "PROFESSIONAL_SUMMARY",
          "Bom dia, {nome}! Hoje: {quantidade}, o primeiro às {hora}.",
        ),
      );
    });

    it("manda o número de atendimentos e o primeiro horário, uma chave por dia", async () => {
      prismaMock.appointment.findMany.mockResolvedValue([
        appointment("a1", "12:00"),
        appointment("a2", "14:00"),
        // Cancelado não conta.
        appointment("a3", "15:00", { status: "CANCELLED" }),
      ]);
      const sent = await job.summaries(NOW_SUMMARY);
      expect(sent).toBe(1);
      expect(dispatcherMock.notify).toHaveBeenCalledWith({
        companyId: "company-1",
        userIds: ["user-1"],
        category: "DAILY_SUMMARY",
        title: "Resumo do dia",
        body: "Bom dia, Camila! Hoje: 2 atendimentos, o primeiro às 09:00.",
        url: "/app/agenda",
        dedupeKey: "summary:2026-11-16",
      });
    });

    it("a turma conta uma vez", async () => {
      prismaMock.appointment.findMany.mockResolvedValue([
        appointment("a1", "12:00", { classSessionId: "s1" }),
        appointment("a2", "12:00", { classSessionId: "s1" }),
      ]);
      await job.summaries(NOW_SUMMARY);
      expect(dispatcherMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("1 atendimento") as string,
        }),
      );
    });

    it("dia livre não manda nada", async () => {
      prismaMock.appointment.findMany.mockResolvedValue([]);
      expect(await job.summaries(NOW_SUMMARY)).toBe(0);
      expect(dispatcherMock.notify).not.toHaveBeenCalled();
    });

    it("antes das 7h30 e depois das 11h não consulta nada", async () => {
      await job.summaries(new Date("2026-11-16T10:00:00.000Z")); // 07:00
      await job.summaries(new Date("2026-11-16T15:00:00.000Z")); // 12:00
      expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
    });

    it("desligado em Mensagens: não manda nada", async () => {
      autoMock.findOne.mockResolvedValue(
        settings("PROFESSIONAL_SUMMARY", "x", false),
      );
      await job.summaries(NOW_SUMMARY);
      expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
    });

    it("cada profissional recebe o seu número", async () => {
      prismaMock.user.findMany.mockResolvedValue([
        { id: "user-1", name: "Camila Rocha", peopleId: "pro-1" },
        { id: "user-2", name: "Rafael Duarte", peopleId: "pro-2" },
      ]);
      prismaMock.appointment.findMany.mockResolvedValue([
        appointment("a1", "12:00"),
        appointment("a2", "13:00", { professionalId: "pro-2" }),
        appointment("a3", "14:00", { professionalId: "pro-2" }),
      ]);
      await job.summaries(NOW_SUMMARY);
      const bodies = (
        dispatcherMock.notify.mock.calls as [
          { userIds: string[]; body: string },
        ][]
      ).map(([call]) => [call.userIds[0], call.body]);
      expect(bodies).toEqual([
        ["user-1", expect.stringContaining("1 atendimento,") as string],
        ["user-2", expect.stringContaining("2 atendimentos,") as string],
      ]);
    });
  });
});
