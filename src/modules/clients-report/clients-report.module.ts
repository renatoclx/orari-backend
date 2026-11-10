import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { ClientsReportController } from "./clients-report.controller";
import { ClientsReportService } from "./clients-report.service";

// Relatórios → Perfil do cliente.
@Module({
  imports: [CompanyModule],
  controllers: [ClientsReportController],
  providers: [ClientsReportService],
})
export class ClientsReportModule {}
