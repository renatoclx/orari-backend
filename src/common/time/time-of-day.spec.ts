import { describe, expect, it } from "vitest";
import {
  formatTimeOfDay,
  parseTimeOfDay,
  TIME_OF_DAY_PATTERN,
} from "./time-of-day";

describe("time-of-day", () => {
  it.each(["00:00", "09:30", "14:00", "23:59"])(
    "converte %s para Date e de volta sem perder o horário",
    (time) => {
      expect(formatTimeOfDay(parseTimeOfDay(time))).toBe(time);
    },
  );

  it("usa 1970-01-01 UTC como data de referência", () => {
    expect(parseTimeOfDay("14:00").toISOString()).toBe(
      "1970-01-01T14:00:00.000Z",
    );
  });

  it.each(["24:00", "9:30", "14h", "14:60", "", "1400"])(
    "recusa o formato inválido %j",
    (value) => {
      expect(TIME_OF_DAY_PATTERN.test(value)).toBe(false);
    },
  );
});
