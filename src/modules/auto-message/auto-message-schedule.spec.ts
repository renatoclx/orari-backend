import { describe, expect, it } from "vitest";
import {
  formatDayMonth,
  formatTime,
  isBirthday,
  localDate,
  localHour,
  reminderStartRange,
  shiftDate,
} from "./auto-message-schedule";

const TZ = "America/Sao_Paulo";

describe("reminderStartRange", () => {
  it("24h: inícios entre 23h45 e 24h a partir de agora", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(reminderStartRange(now, 1440)).toEqual({
      after: new Date("2026-11-06T11:45:00Z"),
      until: new Date("2026-11-06T12:00:00Z"),
    });
  });

  it("30 min: inícios entre 15 e 30 minutos a partir de agora", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(reminderStartRange(now, 30)).toEqual({
      after: new Date("2026-11-05T12:15:00Z"),
      until: new Date("2026-11-05T12:30:00Z"),
    });
  });
});

describe("relógio da clínica", () => {
  it("data e hora locais (02:00 UTC ainda é o dia anterior em Brasília)", () => {
    const instant = new Date("2026-11-06T02:00:00Z");
    expect(localDate(instant, TZ)).toBe("2026-11-05");
    expect(localHour(instant, TZ)).toBe(23);
  });

  it("dia/mês e hora do agendamento no fuso", () => {
    const instant = new Date("2026-11-12T12:00:00Z");
    expect(formatDayMonth(instant, TZ)).toBe("12/11");
    expect(formatTime(instant, TZ)).toBe("09:00");
  });

  it("shiftDate atravessa o mês", () => {
    expect(shiftDate("2026-11-05", -30)).toBe("2026-10-06");
  });
});

describe("isBirthday", () => {
  const born = (date: string) => new Date(`${date}T00:00:00Z`);

  it("mesmo dia e mês, qualquer ano", () => {
    expect(isBirthday(born("1990-11-05"), "2026-11-05")).toBe(true);
    expect(isBirthday(born("1990-11-06"), "2026-11-05")).toBe(false);
  });

  it("29/02 comemora em 28/02 fora do ano bissexto, e em 29/02 no bissexto", () => {
    expect(isBirthday(born("2000-02-29"), "2027-02-28")).toBe(true);
    expect(isBirthday(born("2000-02-29"), "2028-02-28")).toBe(false);
    expect(isBirthday(born("2000-02-29"), "2028-02-29")).toBe(true);
  });
});
