import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AppointmentService } from "../../appointment/appointment.service";
import { PaymentService } from "../payment.service";

/**
 * Cobrança dos avulsos: a cada 5 minutos, gera um pagamento PENDING para os
 * agendamentos avulsos concluídos que ainda não têm pagamento. Cobre tanto a
 * conclusão feita pelo job de status quanto a feita à mão.
 *
 * Fica no módulo de pagamento, e não no de agendamento, para não criar
 * dependência circular: o PaymentModule já depende do AppointmentModule.
 */
@Injectable()
export class CompletedAppointmentChargeJob {
  private readonly logger = new Logger(CompletedAppointmentChargeJob.name);
  private isRunning = false;

  constructor(
    private readonly appointmentService: AppointmentService,
    private readonly paymentService: PaymentService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handle(): Promise<void> {
    // Evita duas execuções ao mesmo tempo se uma rodada demorar mais que o intervalo
    if (this.isRunning) {
      this.logger.warn("Execução anterior ainda em andamento");
      return;
    }

    this.isRunning = true;

    try {
      const appointments =
        await this.appointmentService.findCompletedStandaloneWithoutPayment();

      // Nada a cobrar: evita uma gravação vazia e um log a cada 05 minutos.
      if (appointments.length === 0) {
        return;
      }

      const created =
        await this.paymentService.createForCompletedAppointments(appointments);
      this.logger.log(
        `Pagamentos gerados para agendamentos avulsos concluídos: ${created}`,
      );
    } catch (error) {
      this.logger.error(
        "Falha ao gerar a cobrança dos agendamentos avulsos concluídos",
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }
}
