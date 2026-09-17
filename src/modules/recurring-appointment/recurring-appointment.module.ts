import { Module } from "@nestjs/common";
import { AppointmentModule } from "../appointment/appointment.module";
import { CompanyModule } from "../company/company.module";
import { PeopleModule } from "../people/people.module";
import { ServiceModule } from "../service/service.module";
import { RecurringAppointmentController } from "./recurring-appointment.controller";
import { RecurringAppointmentService } from "./recurring-appointment.service";

@Module({
  imports: [AppointmentModule, CompanyModule, PeopleModule, ServiceModule],
  controllers: [RecurringAppointmentController],
  providers: [RecurringAppointmentService],
  exports: [RecurringAppointmentService],
})
export class RecurringAppointmentModule {}
