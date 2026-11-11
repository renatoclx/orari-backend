import { describe, expect, it } from "vitest";
import { formatMinutes, minutesOf } from "../../common/time/time-of-day";
import { availableStarts, daysBetween } from "./portal-availability";

const h = (time: string) => minutesOf(time);
const starts = (args: Parameters<typeof availableStarts>[0]) =>
  availableStarts(args).map(formatMinutes);

describe("availableStarts", () => {
  const morning = [{ start: h("09:00"), end: h("12:00") }];

  it("grade de 15 minutos dentro da janela; o atendimento inteiro precisa caber", () => {
    expect(
      starts({ windows: morning, busy: [], duration: 60, notBefore: 0 }),
    ).toEqual([
      "09:00",
      "09:15",
      "09:30",
      "09:45",
      "10:00",
      "10:15",
      "10:30",
      "10:45",
      "11:00",
    ]);
  });

  it("não sobrepõe compromisso e oferece o fim dele (horário quebrado)", () => {
    const busy = [{ start: h("09:00"), end: h("09:50") }];
    const result = starts({
      windows: morning,
      busy,
      duration: 30,
      notBefore: 0,
    });
    expect(result[0]).toBe("09:50");
    expect(result).not.toContain("09:30");
  });

  it("começo da janela fora da grade também é candidato", () => {
    const windows = [{ start: h("09:10"), end: h("10:10") }];
    expect(starts({ windows, busy: [], duration: 60, notBefore: 0 })).toEqual([
      "09:10",
    ]);
  });

  it("intervalo de almoço: não atravessa de uma janela para outra", () => {
    const windows = [
      { start: h("08:00"), end: h("12:00") },
      { start: h("13:00"), end: h("18:00") },
    ];
    const result = starts({ windows, busy: [], duration: 60, notBefore: 0 });
    expect(result).toContain("11:00");
    expect(result).not.toContain("11:30");
    expect(result).toContain("13:00");
  });

  it("respeita o primeiro minuto permitido", () => {
    expect(
      starts({
        windows: morning,
        busy: [],
        duration: 60,
        notBefore: h("10:40"),
      }),
    ).toEqual(["10:45", "11:00"]);
  });

  it("sem janela, nenhum horário", () => {
    expect(
      starts({ windows: [], busy: [], duration: 30, notBefore: 0 }),
    ).toEqual([]);
  });
});

describe("auxiliares", () => {
  it("conta dias entre datas, inclusive na virada de mês e de ano", () => {
    const d = (year: number, month: number, day: number) => ({
      year,
      month,
      day,
    });
    expect(daysBetween(d(2026, 11, 4), d(2026, 11, 4))).toBe(0);
    expect(daysBetween(d(2026, 11, 30), d(2026, 12, 1))).toBe(1);
    expect(daysBetween(d(2026, 12, 31), d(2027, 1, 30))).toBe(30);
    expect(daysBetween(d(2026, 11, 5), d(2026, 11, 4))).toBe(-1);
  });
});
