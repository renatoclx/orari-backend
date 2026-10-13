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
import { AppointmentService } from "../../appointment/appointment.service";
import { PaymentService } from "../payment.service";
import { CompletedAppointmentChargeJob } from "./completed-appointment-charge.job";

describe("CompletedAppointmentChargeJob", () => {
  let job: CompletedAppointmentChargeJob;
  let logSpy: MockInstance;
  let warnSpy: MockInstance;
  let errorSpy: MockInstance;

  // O job só coordena: os dois services são simulados.
  const appointmentServiceMock = {
    findCompletedStandaloneWithoutPayment: vi.fn(),
  };
  const paymentServiceMock = { createForCompletedAppointments: vi.fn() };

  // Um avulso concluído, no formato que a consulta do AppointmentService devolve.
  const completed = [
    {
      id: "appointment-1",
      companyId: "company-1",
      startAt: new Date("2026-10-09T13:00:00.000Z"),
      service: { price: 120 },
      company: { timezone: "America/Sao_Paulo" },
    },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    // Padrão: nada a cobrar.
    appointmentServiceMock.findCompletedStandaloneWithoutPayment.mockResolvedValue(
      [],
    );
    paymentServiceMock.createForCompletedAppointments.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompletedAppointmentChargeJob,
        { provide: AppointmentService, useValue: appointmentServiceMock },
        { provide: PaymentService, useValue: paymentServiceMock },
      ],
    }).compile();

    job = module.get<CompletedAppointmentChargeJob>(
      CompletedAppointmentChargeJob,
    );

    // Espionado após o compile() para não capturar o log interno do Nest.
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
    vi.restoreAllMocks();
  });

  it("deve gerar a cobrança dos avulsos encontrados e registrar no log", async () => {
    appointmentServiceMock.findCompletedStandaloneWithoutPayment.mockResolvedValue(
      completed,
    );
    paymentServiceMock.createForCompletedAppointments.mockResolvedValue(1);

    await job.handle();

    expect(
      paymentServiceMock.createForCompletedAppointments,
    ).toHaveBeenCalledWith(completed);
    expect(logSpy).toHaveBeenCalledWith(
      "Pagamentos gerados para agendamentos avulsos concluídos: 1",
    );
  });

  it("não deve gravar nem logar quando não houver nada a cobrar", async () => {
    await job.handle();

    expect(
      paymentServiceMock.createForCompletedAppointments,
    ).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("não deve permitir execução sobreposta enquanto a anterior estiver em andamento", async () => {
    // A primeira consulta só termina quando o teste mandar.
    let resolveFirst!: (value: typeof completed) => void;
    appointmentServiceMock.findCompletedStandaloneWithoutPayment.mockReturnValueOnce(
      new Promise<typeof completed>((resolve) => {
        resolveFirst = resolve;
      }),
    );

    const firstRun = job.handle();
    await job.handle(); // retorna na hora por causa do isRunning

    expect(warnSpy).toHaveBeenCalledWith(
      "Execução anterior ainda em andamento",
    );
    expect(
      appointmentServiceMock.findCompletedStandaloneWithoutPayment,
    ).toHaveBeenCalledTimes(1);

    resolveFirst(completed);
    await firstRun;

    expect(
      paymentServiceMock.createForCompletedAppointments,
    ).toHaveBeenCalledTimes(1);
  });

  it("deve registrar o erro sem lançar exceção e liberar a próxima execução", async () => {
    const error = new Error("Falha de conexão com o banco");
    appointmentServiceMock.findCompletedStandaloneWithoutPayment.mockRejectedValueOnce(
      error,
    );

    await expect(job.handle()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "Falha ao gerar a cobrança dos agendamentos avulsos concluídos",
      error.stack,
    );

    // O finally liberou o isRunning: a rodada seguinte consulta de novo.
    await job.handle();
    expect(
      appointmentServiceMock.findCompletedStandaloneWithoutPayment,
    ).toHaveBeenCalledTimes(2);
  });

  it("deve registrar o erro mesmo quando o valor lançado não é um Error", async () => {
    paymentServiceMock.createForCompletedAppointments.mockRejectedValueOnce(
      "erro inesperado",
    );
    appointmentServiceMock.findCompletedStandaloneWithoutPayment.mockResolvedValue(
      completed,
    );

    await expect(job.handle()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "Falha ao gerar a cobrança dos agendamentos avulsos concluídos",
      "erro inesperado",
    );
  });
});
