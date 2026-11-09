import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { periodOf, seriesFrame } from "./report-period";

const TZ = "America/Sao_Paulo"; // UTC-3
// 15/11/2026, 12:00 em São Paulo.
const NOW = new Date("2026-11-15T15:00:00.000Z");
const NOVEMBER = {
  start: new Date("2026-11-01T03:00:00.000Z"),
  end: new Date("2026-12-01T03:00:00.000Z"),
};

describe("periodOf", () => {
  it("sem datas, usa o mês atual no fuso da empresa", () => {
    expect(periodOf(undefined, undefined, TZ, NOW)).toEqual(NOVEMBER);
  });

  it("inclui as duas pontas (fim = começo do dia seguinte)", () => {
    expect(periodOf("2026-11-10", "2026-11-10", TZ, NOW)).toEqual({
      start: new Date("2026-11-10T03:00:00.000Z"),
      end: new Date("2026-11-11T03:00:00.000Z"),
    });
  });

  it("recusa fim antes do início", () => {
    expect(() => periodOf("2026-11-10", "2026-11-09", TZ, NOW)).toThrow(
      BadRequestException,
    );
  });
});

describe("seriesFrame", () => {
  it("fora do período: -1", () => {
    const frame = seriesFrame(NOVEMBER, TZ);
    expect(frame.indexOf(new Date("2026-10-31T12:00:00Z"))).toBe(-1);
    expect(frame.indexOf(new Date("2026-12-01T12:00:00Z"))).toBe(-1);
  });

  it("22h em São Paulo conta no dia da empresa", () => {
    const frame = seriesFrame(NOVEMBER, TZ);
    // 05/11 às 22h local = 06/11 01h UTC.
    expect(frame.dates[frame.indexOf(new Date("2026-11-06T01:00:00Z"))]).toBe(
      "2026-11-05",
    );
  });
});
