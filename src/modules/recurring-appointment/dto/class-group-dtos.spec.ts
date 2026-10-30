// @Type (class-transformer) depende do reflect-metadata, que em runtime é carregado pelo Nest.
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { LeaveClassGroupDto } from "./leave-class-group.dto";
import { ReplaceInClassGroupDto } from "./reschedule-appointment.dto";

const uuid = "11111111-1111-4111-8111-111111111111";

async function errorsFor(payload: object, dto: new () => object) {
  const errors = await validate(plainToInstance(dto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe("DTOs da recorrência na turma", () => {
  it("saída da turma: motivo opcional, mas não vazio", async () => {
    await expect(errorsFor({}, LeaveClassGroupDto)).resolves.toEqual([]);
    await expect(
      errorsFor({ note: "Mudou de horário" }, LeaveClassGroupDto),
    ).resolves.toEqual([]);
    await expect(errorsFor({ note: "" }, LeaveClassGroupDto)).resolves.toEqual([
      "note",
    ]);
  });

  it("reposição em turma exige a turma e o início", async () => {
    await expect(
      errorsFor(
        { classGroupId: uuid, startAt: "2026-11-02T11:00:00.000Z" },
        ReplaceInClassGroupDto,
      ),
    ).resolves.toEqual([]);
    await expect(
      errorsFor(
        { startAt: "2026-11-02T11:00:00.000Z" },
        ReplaceInClassGroupDto,
      ),
    ).resolves.toEqual(["classGroupId"]);
    await expect(
      errorsFor(
        { classGroupId: "x", startAt: "ontem" },
        ReplaceInClassGroupDto,
      ),
    ).resolves.toEqual(["classGroupId", "startAt"]);
  });
});
