import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CommissionService } from "../commission.service";

/**
 * Gera as comissões dos atendimentos concluídos. Separado do job de status:
 * se uma rodada falhar, a próxima pega o que faltou (nada se perde).
 */
@Injectable()
export class CommissionJob {
  private readonly logger = new Logger(CommissionJob.name);
  private isRunning = false;

  constructor(private readonly commissionService: CommissionService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handle() {
    // Evita duas rodadas ao mesmo tempo quando uma demora.
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const created = await this.commissionService.generatePending();
      if (created > 0) this.logger.log(`Comissões geradas: ${created}`);
    } catch (error) {
      this.logger.error(
        "Falha ao gerar as comissões",
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }
}
