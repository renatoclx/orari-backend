import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { BusinessHourController } from "./business-hour.controller";
import { BusinessHourService } from "./business-hour.service";

@Module({
  imports: [CompanyModule],
  controllers: [BusinessHourController],
  providers: [BusinessHourService],
  exports: [BusinessHourService],
})
export class BusinessHourModule {}
