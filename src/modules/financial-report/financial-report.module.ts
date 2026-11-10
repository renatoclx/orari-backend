import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { FinancialReportController } from "./financial-report.controller";
import { FinancialReportService } from "./financial-report.service";

// Relatórios → Financeiro.
@Module({
  imports: [CompanyModule],
  controllers: [FinancialReportController],
  providers: [FinancialReportService],
})
export class FinancialReportModule {}
