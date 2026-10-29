// @Type (class-transformer) depende do reflect-metadata, que em runtime é carregado pelo Nest.
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateClassGroupDto } from "./create-class-group.dto";
import {
  CreateClassSessionDto,
  UpdateClassSessionDto,
} from "./create-class-session.dto";
import {
  EnrollClassGroupParticipantDto,
  EnrollClassSessionParticipantDto,
} from "./enroll-class-participant.dto";
import { FindClassGroupsQueryDto } from "./find-class-groups-query.dto";
import { UpdateClassGroupDto } from "./update-class-group.dto";

const uuid = "11111111-1111-4111-8111-111111111111";
const base = {
  serviceId: uuid,
  professionalId: uuid,
  capacity: 5,
  days: [{ weekDay: "MONDAY", startTime: "08:00" }],
};

async function errorsFor(
  payload: object,
  dto: new () => object = CreateClassGroupDto,
) {
  const errors = await validate(plainToInstance(dto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe("CreateClassGroupDto", () => {
  it("aceita turma válida, com ou sem nome", async () => {
    await expect(errorsFor(base)).resolves.toEqual([]);
    await expect(errorsFor({ ...base, name: "Pilates" })).resolves.toEqual([]);
  });

  it.each([
    ["vagas abaixo de 2", { capacity: 1 }, "capacity"],
    ["vagas acima de 100", { capacity: 101 }, "capacity"],
    ["vagas fracionadas", { capacity: 2.5 }, "capacity"],
    ["sem dias", { days: [] }, "days"],
    [
      "horário fora do formato",
      { days: [{ weekDay: "MONDAY", startTime: "8h" }] },
      "days",
    ],
    [
      "dia inexistente",
      { days: [{ weekDay: "FERIADO", startTime: "08:00" }] },
      "days",
    ],
    ["nome com 101 caracteres", { name: "a".repeat(101) }, "name"],
    ["nome vazio", { name: "" }, "name"],
    ["serviço que não é UUID", { serviceId: "x" }, "serviceId"],
    [
      "fim informado no dia",
      { days: [{ weekDay: "MONDAY", startTime: "08:00", endTime: "09:00" }] },
      "days",
    ],
    ["empresa no payload", { companyId: uuid }, "companyId"],
  ])("recusa %s", async (_, override, property) => {
    await expect(errorsFor({ ...base, ...override })).resolves.toEqual([
      property,
    ]);
  });

  it("aceita até 21 horários e recusa o 22º", async () => {
    const day = { weekDay: "MONDAY", startTime: "08:00" };

    await expect(
      errorsFor({ ...base, days: Array.from({ length: 21 }, () => day) }),
    ).resolves.toEqual([]);
    await expect(
      errorsFor({ ...base, days: Array.from({ length: 22 }, () => day) }),
    ).resolves.toEqual(["days"]);
  });
});

describe("UpdateClassGroupDto", () => {
  it("aceita nome, nome nulo, vagas e situação", async () => {
    await expect(
      errorsFor(
        { name: "Nova", capacity: 3, isActive: false },
        UpdateClassGroupDto,
      ),
    ).resolves.toEqual([]);
    await expect(
      errorsFor({ name: null }, UpdateClassGroupDto),
    ).resolves.toEqual([]);
  });

  it.each([["serviceId"], ["professionalId"], ["days"]])(
    "recusa alterar %s (a turma é imutável nesse ponto)",
    async (property) => {
      await expect(
        errorsFor({ [property]: uuid }, UpdateClassGroupDto),
      ).resolves.toEqual([property]);
    },
  );

  it("recusa vagas abaixo de 2", async () => {
    await expect(
      errorsFor({ capacity: 1 }, UpdateClassGroupDto),
    ).resolves.toEqual(["capacity"]);
  });
});

describe("FindClassGroupsQueryDto", () => {
  it("converte as datas e o booleano da query string", async () => {
    const query = plainToInstance(FindClassGroupsQueryDto, {
      from: "2026-10-01",
      to: "2026-10-31",
      isActive: "false",
    });

    await expect(validate(query)).resolves.toEqual([]);
    expect(query.from).toEqual(new Date("2026-10-01"));
    expect(query.isActive).toBe(false);
  });

  it("recusa data inválida", async () => {
    await expect(
      errorsFor({ from: "ontem" }, FindClassGroupsQueryDto),
    ).resolves.toEqual(["from"]);
  });
});

describe("DTOs das sessões", () => {
  it("encaixe na turma fixa exige cliente e início; a observação é opcional", async () => {
    await expect(
      errorsFor(
        { clientId: uuid, startAt: "2026-11-02T11:00:00.000Z", note: "x" },
        EnrollClassGroupParticipantDto,
      ),
    ).resolves.toEqual([]);
    await expect(
      errorsFor({ clientId: uuid }, EnrollClassGroupParticipantDto),
    ).resolves.toEqual(["startAt"]);
    await expect(
      errorsFor({ clientId: "x" }, EnrollClassSessionParticipantDto),
    ).resolves.toEqual(["clientId"]);
  });

  it("encaixe numa sessão não aceita horário (a sessão já define)", async () => {
    await expect(
      errorsFor(
        { clientId: uuid, startAt: "2026-11-02T11:00:00.000Z" },
        EnrollClassSessionParticipantDto,
      ),
    ).resolves.toEqual(["startAt"]);
  });

  it.each([
    [CreateClassSessionDto, { appointmentId: uuid, capacity: 2 }, []],
    [CreateClassSessionDto, { appointmentId: uuid, capacity: 1 }, ["capacity"]],
    [CreateClassSessionDto, { capacity: 3 }, ["appointmentId"]],
    [UpdateClassSessionDto, { capacity: 101 }, ["capacity"]],
    [UpdateClassSessionDto, { capacity: 4 }, []],
  ] as const)("valida as vagas (%#)", async (dto, payload, expected) => {
    await expect(errorsFor(payload, dto)).resolves.toEqual(expected);
  });
});
