import { Module } from "@nestjs/common";
import { RecurringAppointmentModule } from "../recurring-appointment/recurring-appointment.module";
import { NotificationController } from "./notification.controller";
import { NotificationService } from "./notification.service";

@Module({
  imports: [RecurringAppointmentModule],
  controllers: [NotificationController],
  providers: [NotificationService],
})
export class NotificationModule {}
