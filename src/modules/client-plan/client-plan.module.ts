import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { PaymentModule } from "../payment/payment.module";
import { PlanModule } from "../plan/plan.module";
import { RecurringAppointmentModule } from "../recurring-appointment/recurring-appointment.module";
import { ClientPlanController } from "./client-plan.controller";
import { ClientPlanService } from "./client-plan.service";

@Module({
  imports: [
    CompanyModule,
    PaymentModule,
    PlanModule,
    RecurringAppointmentModule,
  ],
  controllers: [ClientPlanController],
  providers: [ClientPlanService],
})
export class ClientPlanModule {}
