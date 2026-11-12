import { Module } from "@nestjs/common";
import { CommissionModule } from "../commission/commission.module";
import { CompanyAccessModule } from "../company-access/company-access.module";
import { CompanyModule } from "../company/company.module";
import { ProfessionalAppController } from "./professional-app.controller";
import { ProfessionalAppService } from "./professional-app.service";
import { ProfessionalCommissionController } from "./professional-commission.controller";
import { ProfessionalCommissionService } from "./professional-commission.service";
import { ProfessionalClientsService } from "./professional-clients.service";
import { ProfessionalHomeService } from "./professional-home.service";
import { ProfessionalLinkService } from "./professional-link.service";

// Consultas do app do profissional (agenda, clientes e comissões).
@Module({
  imports: [CompanyModule, CompanyAccessModule, CommissionModule],
  controllers: [ProfessionalAppController, ProfessionalCommissionController],
  providers: [
    ProfessionalAppService,
    ProfessionalClientsService,
    ProfessionalHomeService,
    ProfessionalCommissionService,
    ProfessionalLinkService,
  ],
})
export class ProfessionalAppModule {}
