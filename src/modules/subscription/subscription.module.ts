import { Module } from "@nestjs/common";
import { SubscriptionPaymentController } from "./subscription-payment.controller";
import { SubscriptionPaymentService } from "./subscription-payment.service";
import { SubscriptionController } from "./subscription.controller";
import { SubscriptionService } from "./subscription.service";

@Module({
  controllers: [SubscriptionController, SubscriptionPaymentController],
  providers: [SubscriptionService, SubscriptionPaymentService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
