import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { PackagesReportController } from "./packages-report.controller";
import { PackagesReportService } from "./packages-report.service";

// Relatórios → Pacotes.
@Module({
  imports: [CompanyModule],
  controllers: [PackagesReportController],
  providers: [PackagesReportService],
})
export class PackagesReportModule {}
