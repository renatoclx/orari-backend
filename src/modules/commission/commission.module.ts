import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { CommissionAdvanceController } from "./commission-advance.controller";
import { CommissionAdvanceService } from "./commission-advance.service";
import { CommissionClosingController } from "./commission-closing.controller";
import { CommissionClosingService } from "./commission-closing.service";
import { CommissionController } from "./commission.controller";
import { CommissionService } from "./commission.service";
import { CommissionJob } from "./jobs/commission.job";

// Comissão do profissional: geração na conclusão (etapa 2), consulta (etapa 3)
// adiantamentos (etapa 4) e fechamento com recibo (etapa 5).
@Module({
  imports: [CompanyModule],
  controllers: [
    CommissionController,
    CommissionAdvanceController,
    CommissionClosingController,
  ],
  providers: [
    CommissionService,
    CommissionAdvanceService,
    CommissionClosingService,
    CommissionJob,
  ],
  exports: [CommissionService, CommissionAdvanceService],
})
export class CommissionModule {}
