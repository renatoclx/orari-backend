import { Module } from "@nestjs/common";
import { CommissionService } from "./commission.service";
import { CommissionJob } from "./jobs/commission.job";

// Comissão do profissional: geração na conclusão (etapa 2). Tela, adiantamentos
// e fechamento entram nas próximas etapas.
@Module({
  providers: [CommissionService, CommissionJob],
  exports: [CommissionService],
})
export class CommissionModule {}
