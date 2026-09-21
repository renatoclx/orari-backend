import { Module } from "@nestjs/common";
import { BusinessHourModule } from "../business-hour/business-hour.module";
import { PeopleModule } from "../people/people.module";
import { ServiceModule } from "../service/service.module";
import { AppointmentController } from "./appointment.controller";
import { AppointmentService } from "./appointment.service";

@Module({
  imports: [BusinessHourModule, PeopleModule, ServiceModule],
  controllers: [AppointmentController],
  providers: [AppointmentService],
  exports: [AppointmentService],
})
export class AppointmentModule {}
