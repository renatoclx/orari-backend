import { Module } from "@nestjs/common";
import { BusinessHourModule } from "../business-hour/business-hour.module";
import { CompanyModule } from "../company/company.module";
import { PeopleModule } from "../people/people.module";
import { ServiceModule } from "../service/service.module";
import { ClassGroupController } from "./class-group.controller";
import { ClassGroupService } from "./class-group.service";

@Module({
  imports: [ServiceModule, PeopleModule, BusinessHourModule, CompanyModule],
  controllers: [ClassGroupController],
  providers: [ClassGroupService],
  exports: [ClassGroupService],
})
export class ClassGroupModule {}
