import { Module } from "@nestjs/common";
import { AppointmentModule } from "../appointment/appointment.module";
import { PaymentMethodModule } from "../payment-method/payment-method.module";
import { ServiceModule } from "../service/service.module";
import { PaymentController } from "./payment.controller";
import { PaymentService } from "./payment.service";
import { CompletedAppointmentChargeJob } from "./jobs/completed-appointment-charge.job";

@Module({
  imports: [AppointmentModule, PaymentMethodModule, ServiceModule],
  controllers: [PaymentController],
  providers: [PaymentService, CompletedAppointmentChargeJob],
  exports: [PaymentService],
})
export class PaymentModule {}
