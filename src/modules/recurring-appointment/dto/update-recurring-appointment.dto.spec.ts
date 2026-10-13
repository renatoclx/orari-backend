import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { UpdateRecurringAppointmentDto } from "./update-recurring-appointment.dto";

async function errorsFor(payload: object) {
  const errors = await validate(
    plainToInstance(UpdateRecurringAppointmentDto, payload),
    { whitelist: true, forbidNonWhitelisted: true },
  );
  return errors.map((error) => error.property);
}

describe("UpdateRecurringAppointmentDto (sem regeneração)", () => {
  it("deve aceitar observação e cancelamento", async () => {
    await expect(
      errorsFor({ note: "remarcar com a recepção", isActive: false }),
    ).resolves.toEqual([]);
  });

  it("deve recusar reativação", async () => {
    await expect(errorsFor({ isActive: true })).resolves.toEqual(["isActive"]);
  });

  it("deve recusar mudanças de agenda", async () => {
    await expect(
      errorsFor({
        endDate: "2026-12-01",
        days: [{ weekDay: "MONDAY", startTime: "08:00", endTime: "09:00" }],
      }),
    ).resolves.toEqual(["endDate", "days"]);
  });
});
