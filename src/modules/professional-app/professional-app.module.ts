import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { ProfessionalAppController } from "./professional-app.controller";
import { ProfessionalAppService } from "./professional-app.service";

// Consultas do app do profissional (agenda; depois clientes e comissões).
@Module({
  imports: [CompanyModule],
  controllers: [ProfessionalAppController],
  providers: [ProfessionalAppService],
})
export class ProfessionalAppModule {}
