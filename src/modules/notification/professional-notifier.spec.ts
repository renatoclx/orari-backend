import { describe, expect, it } from "vitest";
import {
  attendanceCount,
  reminderUnits,
  summaryWindowOpen,
  type ReminderRow,
} from "./professional-notifier";

const TZ = "America/Sao_Paulo";

describe("reminderUnits", () => {
  const row = (
    overrides: Partial<ReminderRow> & { id: string },
  ): ReminderRow => ({
    startAt: new Date("2026-11-16T12:00:00.000Z"),
    professionalId: "pro-1",
    classSessionId: null,
    serviceName: "Corte",
    ...overrides,
  });

  it("um lembrete por atendimento avulso, com a chave do agendamento", () => {
    const units = reminderUnits([row({ id: "a" }), row({ id: "b" })]);
    expect(units.map((unit) => unit.key)).toEqual([
      "appointment:a",
      "appointment:b",
    ]);
  });

  it("a turma vira um lembrete só, qualquer que seja o número de alunos", () => {
    const units = reminderUnits([
      row({ id: "a1", classSessionId: "s1", serviceName: "Pilates" }),
      row({ id: "a2", classSessionId: "s1", serviceName: "Pilates" }),
      row({ id: "a3", classSessionId: "s1", serviceName: "Pilates" }),
    ]);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      key: "class-session:s1",
      serviceName: "Pilates",
    });
  });

  it("a mesma sessão de dois profissionais vale uma vez para cada", () => {
    const units = reminderUnits([
      row({ id: "a1", classSessionId: "s1", professionalId: "pro-1" }),
      row({ id: "a2", classSessionId: "s1", professionalId: "pro-2" }),
    ]);
    expect(units.map((unit) => unit.professionalId)).toEqual([
      "pro-1",
      "pro-2",
    ]);
  });
});

describe("summaryWindowOpen", () => {
  // 7h30 em São Paulo (UTC-3) é 10:30 UTC.
  const at = (utc: string) => new Date(`2026-11-16T${utc}:00.000Z`);

  it("abre às 7h30, não antes", () => {
    expect(summaryWindowOpen(at("10:29"), TZ)).toBe(false);
    expect(summaryWindowOpen(at("10:30"), TZ)).toBe(true);
  });

  it("segue aberta até as 11h (um reinício da API ainda entrega o resumo)", () => {
    expect(summaryWindowOpen(at("13:59"), TZ)).toBe(true);
    expect(summaryWindowOpen(at("14:00"), TZ)).toBe(false);
    expect(summaryWindowOpen(at("22:00"), TZ)).toBe(false);
  });

  it("usa o relógio da clínica, não o UTC", () => {
    // 10:30 UTC é 07:30 em São Paulo, mas 19:30 em Tóquio.
    expect(summaryWindowOpen(at("10:30"), "Asia/Tokyo")).toBe(false);
  });
});

describe("attendanceCount", () => {
  it("usa o singular só para um", () => {
    expect(attendanceCount(1)).toBe("1 atendimento");
    expect(attendanceCount(5)).toBe("5 atendimentos");
  });
});
