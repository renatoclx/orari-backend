import { Module } from "@nestjs/common";
import { CompanyAccessController } from "./company-access.controller";
import { CompanyAccessService } from "./company-access.service";
import { PlanLimitService } from "./plan-limit.service";

@Module({
  controllers: [CompanyAccessController],
  providers: [CompanyAccessService, PlanLimitService],
  exports: [CompanyAccessService, PlanLimitService],
})
export class CompanyAccessModule {}
