import { Module } from "@nestjs/common";
import { AppointmentModule } from "../appointment/appointment.module";
import { PaymentMethodModule } from "../payment-method/payment-method.module";
import { ServiceModule } from "../service/service.module";
import { PaymentController } from "./payment.controller";
import { PaymentService } from "./payment.service";

@Module({
  imports: [AppointmentModule, PaymentMethodModule, ServiceModule],
  controllers: [PaymentController],
  providers: [PaymentService],
})
export class PaymentModule {}
