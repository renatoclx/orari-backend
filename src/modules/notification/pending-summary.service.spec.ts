import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { CompanyAccessService } from "../company-access/company-access.service";
import { PendingSummaryService } from "./pending-summary.service";

const TZ = "America/Sao_Paulo";
// 13/11/2026 às 08:00 em São Paulo (UTC-3).
const NOW = new Date("2026-11-13T11:00:00.000Z");

describe("PendingSummaryService", () => {
  const prismaMock = {
    payable: { count: vi.fn() },
    payment: { count: vi.fn() },
    appointment: { findMany: vi.fn() },
    people: { findMany: vi.fn() },
  };
  const accessMock = { can: vi.fn() };
  const service = new PendingSummaryService(
    prismaMock as unknown as PrismaService,
    accessMock as unknown as CompanyAccessService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    accessMock.can.mockResolvedValue(true);
    prismaMock.payable.count.mockResolvedValue(0);
    prismaMock.payment.count.mockResolvedValue(0);
    prismaMock.appointment.findMany.mockResolvedValue([]);
    prismaMock.people.findMany.mockResolvedValue([]);
  });

  it("devolve os cinco itens na ordem do catálogo e o dia da clínica", async () => {
    const result = await service.compute("company-1", NOW, TZ);
    expect(result.date).toBe("2026-11-13");
    expect(result.items.map((entry) => entry.item)).toEqual([
      "PAYABLE_TODAY",
      "PAYABLE_OVERDUE",
      "RECEIVABLE_OVERDUE",
      "OPEN_TABS",
      "BIRTHDAYS",
    ]);
  });

  it("a pagar hoje (vencimento hoje) e atrasadas (antes de hoje) olham só as pendentes da empresa", async () => {
    prismaMock.payable.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    const result = await service.compute("company-1", NOW, TZ, [
      "PAYABLE_TODAY",
      "PAYABLE_OVERDUE",
    ]);
    expect(result.items).toEqual([
      { item: "PAYABLE_TODAY", count: 3 },
      { item: "PAYABLE_OVERDUE", count: 2 },
    ]);
    const today = new Date("2026-11-13T00:00:00.000Z");
    expect(prismaMock.payable.count).toHaveBeenNthCalledWith(1, {
      where: { companyId: "company-1", status: "PENDING", dueDate: today },
    });
    expect(prismaMock.payable.count).toHaveBeenNthCalledWith(2, {
      where: {
        companyId: "company-1",
        status: "PENDING",
        dueDate: { lt: today },
      },
    });
  });

  it("recebimentos atrasados: pendentes não excluídos com vencimento antes de hoje", async () => {
    prismaMock.payment.count.mockResolvedValue(5);
    const result = await service.compute("company-1", NOW, TZ, [
      "RECEIVABLE_OVERDUE",
    ]);
    expect(result.items).toEqual([{ item: "RECEIVABLE_OVERDUE", count: 5 }]);
    expect(prismaMock.payment.count).toHaveBeenCalledWith({
      where: {
        companyId: "company-1",
        deletedAt: null,
        status: "PENDING",
        dueDate: { lt: new Date("2026-11-13T00:00:00.000Z") },
      },
    });
  });

  it("comandas: clientes distintos com atendimento hoje (cancelado e falta ficam de fora)", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([
      { clientId: "c1" },
      { clientId: "c2" },
    ]);
    const result = await service.compute("company-1", NOW, TZ, ["OPEN_TABS"]);
    expect(result.items).toEqual([{ item: "OPEN_TABS", count: 2 }]);
    const [[args]] = prismaMock.appointment.findMany.mock.calls as [
      { where: Record<string, unknown>; distinct: string[] },
    ][];
    expect(args.distinct).toEqual(["clientId"]);
    expect(args.where).toMatchObject({
      companyId: "company-1",
      status: { in: ["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "COMPLETED"] },
      startAt: {
        gte: new Date("2026-11-13T03:00:00.000Z"),
        lt: new Date("2026-11-14T03:00:00.000Z"),
      },
    });
  });

  it("aniversariantes: clientes ativos que fazem aniversário hoje", async () => {
    prismaMock.people.findMany.mockResolvedValue([
      { birthDate: new Date("1990-11-13T00:00:00.000Z") },
      { birthDate: new Date("1985-11-14T00:00:00.000Z") },
      { birthDate: new Date("2000-11-13T00:00:00.000Z") },
    ]);
    const result = await service.compute("company-1", NOW, TZ, ["BIRTHDAYS"]);
    expect(result.items).toEqual([{ item: "BIRTHDAYS", count: 2 }]);
  });

  it("item sem a funcionalidade no plano não entra (nem consulta)", async () => {
    accessMock.can.mockImplementation((_company: string, feature: string) =>
      Promise.resolve(feature !== "payables"),
    );
    const result = await service.compute("company-1", NOW, TZ);
    expect(result.items.map((entry) => entry.item)).toEqual([
      "RECEIVABLE_OVERDUE",
      "OPEN_TABS",
      "BIRTHDAYS",
    ]);
    expect(prismaMock.payable.count).not.toHaveBeenCalled();
  });

  it("only restringe aos itens escolhidos", async () => {
    const result = await service.compute("company-1", NOW, TZ, ["BIRTHDAYS"]);
    expect(result.items.map((entry) => entry.item)).toEqual(["BIRTHDAYS"]);
    expect(prismaMock.payable.count).not.toHaveBeenCalled();
  });
});
