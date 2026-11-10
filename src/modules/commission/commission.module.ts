import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { CommissionAdvanceController } from "./commission-advance.controller";
import { CommissionAdvanceService } from "./commission-advance.service";
import { CommissionController } from "./commission.controller";
import { CommissionService } from "./commission.service";
import { CommissionJob } from "./jobs/commission.job";

// Comissão do profissional: geração na conclusão (etapa 2), consulta (etapa 3)
// e adiantamentos (etapa 4). O fechamento entra na etapa 5.
@Module({
  imports: [CompanyModule],
  controllers: [CommissionController, CommissionAdvanceController],
  providers: [CommissionService, CommissionAdvanceService, CommissionJob],
  exports: [CommissionService],
})
export class CommissionModule {}
