import { Module } from "@nestjs/common";
import { AppointmentModule } from "../appointment/appointment.module";
import { CompanyModule } from "../company/company.module";
import { PaymentMethodModule } from "../payment-method/payment-method.module";
import { ServiceModule } from "../service/service.module";
import { PaymentCheckoutService } from "./payment-checkout.service";
import { PaymentController } from "./payment.controller";
import { PaymentService } from "./payment.service";
import { CompletedAppointmentChargeJob } from "./jobs/completed-appointment-charge.job";

@Module({
  imports: [
    AppointmentModule,
    CompanyModule,
    PaymentMethodModule,
    ServiceModule,
  ],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    PaymentCheckoutService,
    CompletedAppointmentChargeJob,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
