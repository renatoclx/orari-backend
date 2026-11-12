import { describe, expect, it } from "vitest";
import { buildHome, homeRanges, type HomeRow } from "./professional-home";

const TZ = "America/Sao_Paulo";
// Quinta, 12/11/2026, 10:00 em São Paulo (UTC-3).
const NOW = new Date("2026-11-12T13:00:00.000Z");

let seq = 0;
// `at` é o horário local ("2026-11-12T09:00") no relógio de São Paulo.
function row(
  at: string,
  overrides: Partial<HomeRow> & { minutes?: number } = {},
): HomeRow {
  const startAt = new Date(`${at}:00-03:00`);
  const { minutes = 60, ...rest } = overrides;
  seq += 1;
  return {
    id: `a${seq}`,
    startAt,
    endAt: new Date(startAt.getTime() + minutes * 60_000),
    status: "SCHEDULED",
    classSessionId: null,
    clientId: `c${seq}`,
    clientName: `Cliente ${seq}`,
    serviceName: "Corte",
    ...rest,
  };
}

const home = (rows: HomeRow[], upcoming: HomeRow[] = []) =>
  buildHome(rows, upcoming, NOW, TZ);

describe("homeRanges", () => {
  it("a semana começa na segunda e o intervalo cobre o mês anterior", () => {
    const range = homeRanges(NOW, TZ);
    expect(range.monday).toEqual({ year: 2026, month: 11, day: 9 });
    expect(range.todayStart).toEqual(new Date("2026-11-12T03:00:00.000Z"));
    expect(range.previousMonthStart).toEqual(
      new Date("2026-10-01T03:00:00.000Z"),
    );
    expect(range.nextMonthStart).toEqual(new Date("2026-12-01T03:00:00.000Z"));
    expect(range.from).toEqual(range.previousMonthStart);
  });

  it("no domingo, a semana ainda é a que começou na segunda anterior", () => {
    // Domingo, 15/11/2026.
    const range = homeRanges(new Date("2026-11-15T15:00:00.000Z"), TZ);
    expect(range.monday).toEqual({ year: 2026, month: 11, day: 9 });
  });

  it("em janeiro, o mês anterior é dezembro e a semana pode vir do ano passado", () => {
    // Sexta, 01/01/2027.
    const range = homeRanges(new Date("2027-01-01T15:00:00.000Z"), TZ);
    expect(range.previousFirst).toEqual({ year: 2026, month: 12, day: 1 });
    expect(range.monday).toEqual({ year: 2026, month: 12, day: 28 });
  });

  it("à noite o dia ainda é o do relógio da clínica, não o do UTC", () => {
    // 01:00 UTC de 13/11 ainda é quinta, 12/11, em São Paulo.
    const range = homeRanges(new Date("2026-11-13T01:00:00.000Z"), TZ);
    expect(range.today).toMatchObject({ year: 2026, month: 11, day: 12 });
  });
});

describe("buildHome: hoje", () => {
  it("conta os de hoje sem os cancelados e separa o que ainda resta", () => {
    const result = home([
      row("2026-11-12T08:00", { status: "COMPLETED" }),
      row("2026-11-12T09:00", { status: "CANCELLED" }),
      row("2026-11-12T14:00", { clientName: "Ana" }),
      row("2026-11-12T16:00", { status: "CONFIRMED" }),
    ]);
    expect(result.today.total).toBe(3);
    expect(result.today.remaining).toBe(2);
    expect(result.today.next).toMatchObject({
      clientName: "Ana",
      inProgress: false,
    });
  });

  it("o que está em andamento vem como o próximo, marcado", () => {
    const result = home([
      row("2026-11-12T09:30", { status: "IN_PROGRESS" }),
      row("2026-11-12T14:00"),
    ]);
    expect(result.today.next).toMatchObject({ inProgress: true });
  });

  it("sem atendimentos, não há próximo", () => {
    expect(home([]).today).toEqual({ total: 0, remaining: 0, next: null });
  });

  it("a turma é um atendimento só e não mostra aluno", () => {
    const result = home([
      row("2026-11-12T14:00", { classSessionId: "s1", clientName: "Bia" }),
      row("2026-11-12T14:00", { classSessionId: "s1", clientName: "Caio" }),
      row("2026-11-12T14:00", { classSessionId: "s1", status: "CANCELLED" }),
    ]);
    expect(result.today.total).toBe(1);
    expect(result.today.next).toMatchObject({
      isClass: true,
      clientName: null,
    });
  });

  it("a turma em que todos cancelaram sai da conta", () => {
    const result = home([
      row("2026-11-12T14:00", { classSessionId: "s1", status: "CANCELLED" }),
      row("2026-11-12T14:00", { classSessionId: "s1", status: "CANCELLED" }),
    ]);
    expect(result.today.total).toBe(0);
  });
});

describe("buildHome: semana", () => {
  it("traz os sete dias de segunda a domingo, sem os cancelados", () => {
    const result = home([
      row("2026-11-09T09:00", { status: "COMPLETED" }),
      row("2026-11-09T10:00", { status: "COMPLETED" }),
      row("2026-11-11T09:00", { status: "CANCELLED" }),
      row("2026-11-12T14:00"),
      row("2026-11-15T09:00"),
      // Fora da semana (segunda seguinte e domingo anterior).
      row("2026-11-16T09:00"),
      row("2026-11-08T09:00", { status: "COMPLETED" }),
    ]);
    expect(result.week.map((day) => day.date)).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
    expect(result.week.map((day) => day.count)).toEqual([2, 0, 0, 1, 0, 0, 1]);
  });

  it("um atendimento de madrugada cai no dia do relógio da clínica", () => {
    // 23:30 de terça em SP é 02:30 UTC de quarta.
    const result = home([row("2026-11-10T23:30")]);
    expect(result.week[1].count).toBe(1);
    expect(result.week[2].count).toBe(0);
  });
});

describe("buildHome: mês", () => {
  it("conta concluídos, faltas, cancelados e clientes distintos", () => {
    const result = home([
      row("2026-11-03T09:00", { status: "COMPLETED", clientId: "x" }),
      row("2026-11-05T09:00", { status: "COMPLETED", clientId: "x" }),
      row("2026-11-06T09:00", { status: "COMPLETED", clientId: "y" }),
      row("2026-11-07T09:00", { status: "NO_SHOW" }),
      row("2026-11-08T09:00", { status: "CANCELLED" }),
      row("2026-11-20T09:00"),
    ]);
    expect(result.month).toMatchObject({
      month: "2026-11",
      completed: 3,
      noShow: 1,
      cancelled: 1,
      clients: 2,
    });
  });

  it("compara com os concluídos do mês anterior", () => {
    const result = home([
      row("2026-10-10T09:00", { status: "COMPLETED" }),
      row("2026-10-31T23:00", { status: "COMPLETED" }),
      row("2026-10-12T09:00", { status: "CANCELLED" }),
      row("2026-11-03T09:00", { status: "COMPLETED" }),
    ]);
    expect(result.month.previousCompleted).toBe(2);
    expect(result.month.completed).toBe(1);
  });

  it("o último minuto do mês ainda conta no mês", () => {
    const result = home([
      row("2026-11-30T23:30", { status: "COMPLETED", minutes: 15 }),
    ]);
    expect(result.month.completed).toBe(1);
  });

  it("sessão de turma concluída conta uma vez; as faltas contam por aluno", () => {
    const result = home([
      row("2026-11-04T10:00", { classSessionId: "s1", status: "COMPLETED" }),
      row("2026-11-04T10:00", { classSessionId: "s1", status: "COMPLETED" }),
      row("2026-11-04T10:00", { classSessionId: "s1", status: "NO_SHOW" }),
    ]);
    expect(result.month.completed).toBe(1);
    expect(result.month.noShow).toBe(1);
    expect(result.month.clients).toBe(2);
  });
});

describe("buildHome: próximos", () => {
  it("devolve só os três primeiros, juntando a turma", () => {
    const upcoming = [
      row("2026-11-13T09:00", { classSessionId: "s1" }),
      row("2026-11-13T09:00", { classSessionId: "s1" }),
      row("2026-11-13T11:00", { clientName: "Ana" }),
      row("2026-11-14T09:00", { clientName: "Bia" }),
      row("2026-11-14T10:00", { clientName: "Caio" }),
    ];
    const result = home([], upcoming);
    expect(result.upcoming).toHaveLength(3);
    expect(result.upcoming[0]).toMatchObject({
      isClass: true,
      clientName: null,
    });
    expect(result.upcoming.map((item) => item.clientName)).toEqual([
      null,
      "Ana",
      "Bia",
    ]);
  });
});
