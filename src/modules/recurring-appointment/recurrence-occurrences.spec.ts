import { describe, expect, it } from "vitest";
import { WeekDay } from "../../../generated/prisma/enums";
import { buildOccurrences, minutesBetween } from "./recurrence-occurrences";

const SP = "America/Sao_Paulo"; // UTC-3
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const tuesdayAt14 = [
  { weekDay: WeekDay.TUESDAY, startTime: "14:00", endTime: "15:00" },
];

describe("buildOccurrences", () => {
  it("gera cada terça às 14h no fuso da empresa, até a data final (incluída)", () => {
    const occurrences = buildOccurrences(
      tuesdayAt14,
      date("2026-12-01"),
      date("2026-12-15"),
      60,
      SP,
      new Date("2026-11-20T12:00:00.000Z"),
    );

    expect(occurrences.map((item) => item.startAt.toISOString())).toEqual([
      "2026-12-01T17:00:00.000Z",
      "2026-12-08T17:00:00.000Z",
      "2026-12-15T17:00:00.000Z",
    ]);
    expect(occurrences[0].endAt.toISOString()).toBe("2026-12-01T18:00:00.000Z");
  });

  it("não cria ocorrência que já passou", () => {
    // Terça, 01/12/2026, 15h em São Paulo: a aula das 14h já passou.
    const occurrences = buildOccurrences(
      tuesdayAt14,
      date("2026-12-01"),
      date("2026-12-08"),
      60,
      SP,
      new Date("2026-12-01T18:00:00.000Z"),
    );

    expect(occurrences.map((item) => item.startAt.toISOString())).toEqual([
      "2026-12-08T17:00:00.000Z",
    ]);
  });
});

describe("minutesBetween", () => {
  it("conta os minutos entre dois horários do dia", () => {
    expect(minutesBetween("14:00", "15:30")).toBe(90);
  });
});
