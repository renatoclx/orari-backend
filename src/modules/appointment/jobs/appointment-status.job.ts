import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../../prisma/prisma.service";
import { AppointmentStatus } from "../../../../generated/prisma/client";

@Injectable()
export class AppointmentStatusJob {
  private readonly logger = new Logger(AppointmentStatusJob.name);
  private isRunning = false;

  constructor(private readonly prisma: PrismaService) {}

  // Cron aceita métodos assincronos
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handle() {
    // if para evitar sobreposição de Jobs, caso haja lentidão em alguma parte
    if (this.isRunning) {
      this.logger.warn("Execução anterior ainda em andamento.");
      return;
    }

    this.isRunning = true;

    try {
      // As três condições não se sobrepõem (nenhum registro satisfaz duas),
      // então a ordem das queries não importa
      const now = new Date();

      // updateMany altera todos os registros dentro do where em uma única query.
      // O status no where é checado no momento da escrita: se o usuário cancelar
      // no meio da execução, o registro não é sobrescrito. Isso também torna o
      // job idempotente (rodar de novo não causa efeito extra).
      const started = await this.prisma.appointment.updateMany({
        where: {
          status: {
            // Encontrar status dentro da cláusula
            in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
          },
          startAt: { lte: now }, // lte: less than or equal (<=)
          endAt: { gt: now }, // gt: greater than (>)
        },
        data: { status: AppointmentStatus.IN_PROGRESS },
      });

      // Devido a endAt estar como now em todas as chamadas, não importa a ordem de execução dos jobs

      const completed = await this.prisma.appointment.updateMany({
        where: {
          status: AppointmentStatus.IN_PROGRESS,
          endAt: { lte: now },
        },
        data: { status: AppointmentStatus.COMPLETED },
      });

      // Verifica se existe chamado antigo não completado e altera o status para COMPLETED
      const completedLate = await this.prisma.appointment.updateMany({
        where: {
          status: {
            in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
          },
          endAt: { lte: now },
        },
        data: { status: AppointmentStatus.COMPLETED },
      });

      // Só mostra a mensagem se de fato houver alteração de registro
      if (started.count > 0 || completed.count > 0) {
        this.logger.log(
          `Iniciados: ${started.count} | Completos: ${completed.count}`,
        );
      }

      if (completedLate.count > 0) {
        this.logger.warn(`Concluídos com atraso: ${completedLate.count}`);
      }
    } catch (error) {
      // No TS, error do catch é do tipo unknown
      // A checagem com instance of garante que se caso houver stack trace, ele envie a informação
      this.logger.error(
        "Falha ao atualizar os status dos agendamentos",
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }
}
