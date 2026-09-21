import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";

@Module({
  imports: [CompanyModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
