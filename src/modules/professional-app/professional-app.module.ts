import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { ProfessionalAppController } from "./professional-app.controller";
import { ProfessionalAppService } from "./professional-app.service";
import { ProfessionalClientsService } from "./professional-clients.service";
import { ProfessionalLinkService } from "./professional-link.service";

// Consultas do app do profissional (agenda, clientes; depois comissões).
@Module({
  imports: [CompanyModule],
  controllers: [ProfessionalAppController],
  providers: [
    ProfessionalAppService,
    ProfessionalClientsService,
    ProfessionalLinkService,
  ],
})
export class ProfessionalAppModule {}
