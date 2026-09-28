import { Logger } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { PrismaService } from "../../../prisma/prisma.service";
import { AppointmentStatus } from "../../../../generated/prisma/client";
import { AppointmentStatusJob } from "./appointment-status.job";

describe("AppointmentStatusJob", () => {
  let job: AppointmentStatusJob;
  let logSpy: MockInstance;
  let warnSpy: MockInstance;
  let errorSpy: MockInstance;

  const prismaMock = {
    appointment: {
      updateMany: vi.fn(),
    },
  };

  // Data fixa para que os filtros (startAt/endAt lte/gt now) sejam determinísticos.
  const now = new Date("2026-01-15T10:00:00.000Z");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    prismaMock.appointment.updateMany.mockResolvedValue({ count: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentStatusJob,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    job = module.get<AppointmentStatusJob>(AppointmentStatusJob);

    // Espionado após o compile() para não capturar o log interno do Nest
    // ("RootTestModule dependencies initialized").
    logSpy = vi
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
    warnSpy = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    errorSpy = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("deve consultar e atualizar os agendamentos com os filtros corretos", async () => {
    prismaMock.appointment.updateMany
      .mockResolvedValueOnce({ count: 2 }) // started
      .mockResolvedValueOnce({ count: 1 }) // completed
      .mockResolvedValueOnce({ count: 0 }); // completedLate

    await job.handle();

    expect(prismaMock.appointment.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: {
          in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
        },
        startAt: { lte: now },
        endAt: { gt: now },
      },
      data: { status: AppointmentStatus.IN_PROGRESS },
    });

    expect(prismaMock.appointment.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        status: AppointmentStatus.IN_PROGRESS,
        endAt: { lte: now },
      },
      data: { status: AppointmentStatus.COMPLETED },
    });

    expect(prismaMock.appointment.updateMany).toHaveBeenNthCalledWith(3, {
      where: {
        status: {
          in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
        },
        endAt: { lte: now },
      },
      data: { status: AppointmentStatus.COMPLETED },
    });
  });

  it("não deve logar nada quando nenhum agendamento for alterado", async () => {
    await job.handle();

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("deve logar os totais quando iniciar ou concluir agendamentos no horário", async () => {
    prismaMock.appointment.updateMany
      .mockResolvedValueOnce({ count: 3 }) // started
      .mockResolvedValueOnce({ count: 2 }) // completed
      .mockResolvedValueOnce({ count: 0 }); // completedLate

    await job.handle();

    expect(logSpy).toHaveBeenCalledWith("Iniciados: 3 | Completos: 2");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("deve logar aviso quando concluir agendamentos com atraso", async () => {
    prismaMock.appointment.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 4 }); // completedLate

    await job.handle();

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("Concluídos com atraso: 4");
  });

  it("não deve permitir execução sobreposta enquanto a anterior estiver em andamento", async () => {
    let resolveFirstUpdate!: (value: { count: number }) => void;
    const pending = new Promise<{ count: number }>((resolve) => {
      resolveFirstUpdate = resolve;
    });

    prismaMock.appointment.updateMany.mockReturnValueOnce(pending);
    prismaMock.appointment.updateMany.mockResolvedValue({ count: 0 });

    const firstRun = job.handle();
    await job.handle(); // deve retornar imediatamente por causa do isRunning

    expect(warnSpy).toHaveBeenCalledWith(
      "Execução anterior ainda em andamento.",
    );
    // Somente a primeira query da primeira execução foi disparada até aqui.
    expect(prismaMock.appointment.updateMany).toHaveBeenCalledTimes(1);

    resolveFirstUpdate({ count: 0 });
    await firstRun;

    expect(prismaMock.appointment.updateMany).toHaveBeenCalledTimes(3);
  });

  it("deve permitir uma nova execução após a anterior terminar", async () => {
    await job.handle();
    warnSpy.mockClear();
    await job.handle();

    expect(warnSpy).not.toHaveBeenCalledWith(
      "Execução anterior ainda em andamento.",
    );
    expect(prismaMock.appointment.updateMany).toHaveBeenCalledTimes(6);
  });

  it("deve capturar erro com stack trace sem lançar exceção", async () => {
    const error = new Error("Falha de conexão com o banco");
    prismaMock.appointment.updateMany.mockReset();
    prismaMock.appointment.updateMany.mockRejectedValueOnce(error);

    await expect(job.handle()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "Falha ao atualizar os status dos agendamentos",
      error.stack,
    );
  });

  it("deve capturar erro sem stack trace quando o valor lançado não for uma instância de Error", async () => {
    prismaMock.appointment.updateMany.mockReset();
    prismaMock.appointment.updateMany.mockRejectedValueOnce("erro inesperado");

    await expect(job.handle()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "Falha ao atualizar os status dos agendamentos",
      "erro inesperado",
    );
  });

  it("deve liberar o lock mesmo quando ocorrer um erro, permitindo a próxima execução", async () => {
    prismaMock.appointment.updateMany.mockReset();
    prismaMock.appointment.updateMany.mockRejectedValueOnce(new Error("boom"));

    await job.handle();
    warnSpy.mockClear();

    prismaMock.appointment.updateMany.mockResolvedValue({ count: 0 });
    await job.handle();

    expect(warnSpy).not.toHaveBeenCalledWith(
      "Execução anterior ainda em andamento.",
    );
  });
});
