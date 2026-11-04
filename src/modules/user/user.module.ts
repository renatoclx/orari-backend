import { Module } from "@nestjs/common";
import { CompanyAccessModule } from "../company-access/company-access.module";
import { CompanyModule } from "../company/company.module";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";

@Module({
  imports: [CompanyModule, CompanyAccessModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
