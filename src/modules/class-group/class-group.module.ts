import { Module } from "@nestjs/common";
import { AppointmentModule } from "../appointment/appointment.module";
import { BusinessHourModule } from "../business-hour/business-hour.module";
import { CompanyModule } from "../company/company.module";
import { PeopleModule } from "../people/people.module";
import { ServiceModule } from "../service/service.module";
import { ClassGroupController } from "./class-group.controller";
import { ClassGroupService } from "./class-group.service";
import { ClassSessionController } from "./class-session.controller";
import { ClassSessionService } from "./class-session.service";

@Module({
  imports: [
    AppointmentModule,
    ServiceModule,
    PeopleModule,
    BusinessHourModule,
    CompanyModule,
  ],
  controllers: [ClassGroupController, ClassSessionController],
  providers: [ClassGroupService, ClassSessionService],
  exports: [ClassGroupService, ClassSessionService],
})
export class ClassGroupModule {}
