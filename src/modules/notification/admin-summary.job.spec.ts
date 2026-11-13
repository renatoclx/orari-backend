import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { AutoMessageService } from "../auto-message/auto-message.service";
import { AdminSummaryJob } from "./admin-summary.job";
import type { NotificationDispatcher } from "./notification-dispatcher.service";
import type { NotifierCompanies } from "./notifier-companies.service";
import type { PendingSummaryService } from "./pending-summary.service";

// 13/11/2026 às 08:10 em São Paulo (UTC-3).
const AT_8 = new Date("2026-11-13T11:10:00.000Z");

const settings = (overrides: Record<string, unknown> = {}) => ({
  kind: "ADMIN_SUMMARY",
  enabled: true,
  body: "Bom dia, {nome}! Hoje: {resumo}.",
  reminderOffsets: [],
  missYouDays: null,
  summaryHour: 8,
  summaryItems: ["PAYABLE_TODAY", "BIRTHDAYS"],
  ...overrides,
});

describe("AdminSummaryJob", () => {
  const prismaMock = { user: { findMany: vi.fn() } };
  const companiesMock = { list: vi.fn() };
  const autoMock = { findOne: vi.fn() };
  const pendingMock = { compute: vi.fn() };
  const dispatcherMock = { notify: vi.fn() };
  const job = new AdminSummaryJob(
    prismaMock as unknown as PrismaService,
    companiesMock as unknown as NotifierCompanies,
    autoMock as unknown as AutoMessageService,
    pendingMock as unknown as PendingSummaryService,
    dispatcherMock as unknown as NotificationDispatcher,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    companiesMock.list.mockResolvedValue([
      { id: "company-1", name: "Studio Aurora", timezone: "America/Sao_Paulo" },
    ]);
    autoMock.findOne.mockResolvedValue(settings());
    prismaMock.user.findMany.mockResolvedValue([
      { id: "admin-1", name: "Marina Alves" },
      { id: "admin-2", name: "Paulo Souza" },
    ]);
    pendingMock.compute.mockResolvedValue({
      date: "2026-11-13",
      items: [
        { item: "PAYABLE_TODAY", count: 3 },
        { item: "BIRTHDAYS", count: 2 },
      ],
    });
    dispatcherMock.notify.mockResolvedValue(1);
  });

  it("manda a cada administrador, com o resumo só do que tem número e a chave do dia", async () => {
    const sent = await job.summaries(AT_8);
    expect(sent).toBe(2);
    expect(pendingMock.compute).toHaveBeenCalledWith(
      "company-1",
      AT_8,
      "America/Sao_Paulo",
      ["PAYABLE_TODAY", "BIRTHDAYS"],
    );
    expect(dispatcherMock.notify).toHaveBeenCalledWith({
      companyId: "company-1",
      userIds: ["admin-1"],
      category: "PENDING_SUMMARY",
      title: "Pendências de hoje",
      body: "Bom dia, Marina! Hoje: 3 contas a pagar hoje e 2 aniversariantes.",
      url: "/dashboard",
      dedupeKey: "pending:2026-11-13",
      push: {
        title: "Pendências de hoje",
        body: "Há itens para ver hoje no painel.",
      },
    });
  });

  it("o push não leva números nem dinheiro", async () => {
    await job.summaries(AT_8);
    const [[call]] = dispatcherMock.notify.mock.calls as [
      { push: { body: string } },
    ][];
    expect(call.push.body).not.toMatch(/\d/);
  });

  it("só sai depois da hora escolhida e antes do meio-dia", async () => {
    await job.summaries(new Date("2026-11-13T10:30:00.000Z")); // 07:30
    await job.summaries(new Date("2026-11-13T15:10:00.000Z")); // 12:10
    expect(pendingMock.compute).not.toHaveBeenCalled();
    autoMock.findOne.mockResolvedValue(settings({ summaryHour: 10 }));
    await job.summaries(AT_8); // 08:10, antes das 10h
    expect(pendingMock.compute).not.toHaveBeenCalled();
    await job.summaries(new Date("2026-11-13T13:10:00.000Z")); // 10:10
    expect(pendingMock.compute).toHaveBeenCalledTimes(1);
  });

  it("sem hora gravada, vale as 8h", async () => {
    autoMock.findOne.mockResolvedValue(settings({ summaryHour: null }));
    await job.summaries(new Date("2026-11-13T10:30:00.000Z")); // 07:30
    expect(pendingMock.compute).not.toHaveBeenCalled();
    await job.summaries(AT_8);
    expect(pendingMock.compute).toHaveBeenCalledTimes(1);
  });

  it("nada com número hoje: não manda nada", async () => {
    pendingMock.compute.mockResolvedValue({
      date: "2026-11-13",
      items: [
        { item: "PAYABLE_TODAY", count: 0 },
        { item: "BIRTHDAYS", count: 0 },
      ],
    });
    expect(await job.summaries(AT_8)).toBe(0);
    expect(dispatcherMock.notify).not.toHaveBeenCalled();
  });

  it("desligado em Mensagens: nem calcula", async () => {
    autoMock.findOne.mockResolvedValue(settings({ enabled: false }));
    await job.summaries(AT_8);
    expect(pendingMock.compute).not.toHaveBeenCalled();
  });

  it("só os usuários ADMIN ativos da clínica", async () => {
    await job.summaries(AT_8);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: { companyId: "company-1", deletedAt: null, type: "ADMIN" },
      select: { id: true, name: true },
    });
  });

  it("falha em uma rodada não derruba o job", async () => {
    companiesMock.list.mockRejectedValue(new Error("banco"));
    await expect(job.summaries(AT_8)).resolves.toBe(0);
  });
});
