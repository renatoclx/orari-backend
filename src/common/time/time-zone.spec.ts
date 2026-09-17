import { describe, expect, it } from "vitest";
import {
  isValidTimeZone,
  minutesOfZonedDay,
  toZonedParts,
  weekDayIndexOf,
  zonedToUtc,
} from "./time-zone";

const SP = "America/Sao_Paulo";

describe("time-zone", () => {
  describe("zonedToUtc", () => {
    it("converte o horário local de São Paulo (UTC-3) para UTC", () => {
      const utc = zonedToUtc(
        { year: 2026, month: 10, day: 6, hours: 9, minutes: 0 },
        SP,
      );

      expect(utc.toISOString()).toBe("2026-10-06T12:00:00.000Z");
    });

    it("converte um horário que vira o dia em UTC", () => {
      const utc = zonedToUtc(
        { year: 2026, month: 10, day: 6, hours: 22, minutes: 30 },
        SP,
      );

      expect(utc.toISOString()).toBe("2026-10-07T01:30:00.000Z");
    });

    it("respeita o horário de verão de fusos que o utilizam", () => {
      // Nova York: UTC-4 em julho (verão) e UTC-5 em janeiro.
      const verao = zonedToUtc(
        { year: 2026, month: 7, day: 1, hours: 9, minutes: 0 },
        "America/New_York",
      );
      const inverno = zonedToUtc(
        { year: 2026, month: 1, day: 1, hours: 9, minutes: 0 },
        "America/New_York",
      );

      expect(verao.toISOString()).toBe("2026-07-01T13:00:00.000Z");
      expect(inverno.toISOString()).toBe("2026-01-01T14:00:00.000Z");
    });

    it("é o inverso de toZonedParts", () => {
      const parts = { year: 2026, month: 3, day: 15, hours: 14, minutes: 45 };

      expect(toZonedParts(zonedToUtc(parts, SP), SP)).toEqual(parts);
    });
  });

  describe("minutesOfZonedDay", () => {
    it("lê o horário no relógio da empresa, e não em UTC", () => {
      const instante = new Date("2026-10-06T12:00:00.000Z");

      expect(minutesOfZonedDay(instante, SP)).toBe(9 * 60);
      expect(minutesOfZonedDay(instante, "UTC")).toBe(12 * 60);
    });
  });

  describe("weekDayIndexOf", () => {
    it("identifica o dia da semana da data do calendário", () => {
      // 2026-10-06 é uma terça-feira.
      expect(
        weekDayIndexOf({ year: 2026, month: 10, day: 6, hours: 0, minutes: 0 }),
      ).toBe(2);
    });
  });

  describe("isValidTimeZone", () => {
    // Deslocamentos fixos ("-03:00") são válidos para o Intl, mas não acompanham
    // horário de verão; por isso o padrão do projeto é o nome IANA.
    it.each(["America/Sao_Paulo", "UTC", "Europe/Lisbon", "-03:00"])(
      "aceita o fuso %s",
      (timeZone) => {
        expect(isValidTimeZone(timeZone)).toBe(true);
      },
    );

    it.each(["America/Sao Paulo", "Brasilia", "", "abacaxi"])(
      "recusa o fuso inválido %j",
      (timeZone) => {
        expect(isValidTimeZone(timeZone)).toBe(false);
      },
    );
  });
});
