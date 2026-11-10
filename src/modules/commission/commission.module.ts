import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { CommissionController } from "./commission.controller";
import { CommissionService } from "./commission.service";
import { CommissionJob } from "./jobs/commission.job";

// Comissão do profissional: geração na conclusão (etapa 2) e consulta
// (etapa 3). Adiantamentos e fechamento entram nas próximas etapas.
@Module({
  imports: [CompanyModule],
  controllers: [CommissionController],
  providers: [CommissionService, CommissionJob],
  exports: [CommissionService],
})
export class CommissionModule {}
