import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { AppointmentReportController } from "./appointment-report.controller";
import { AppointmentReportService } from "./appointment-report.service";

// Relatórios → Agendamentos.
@Module({
  imports: [CompanyModule],
  controllers: [AppointmentReportController],
  providers: [AppointmentReportService],
})
export class AppointmentReportModule {}
