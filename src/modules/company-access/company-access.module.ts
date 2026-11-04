import { Module } from "@nestjs/common";
import { CompanyAccessController } from "./company-access.controller";
import { CompanyAccessService } from "./company-access.service";

@Module({
  controllers: [CompanyAccessController],
  providers: [CompanyAccessService],
  exports: [CompanyAccessService],
})
export class CompanyAccessModule {}
