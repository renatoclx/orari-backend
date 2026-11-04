import { Module } from "@nestjs/common";
import { PeopleModule } from "../people/people.module";
import { MessageSenderService } from "./message-sender.service";
import { PortalAuthController } from "./portal-auth.controller";
import { PortalAuthGuard } from "./portal-auth.guard";
import { PortalAuthService } from "./portal-auth.service";

@Module({
  imports: [PeopleModule],
  controllers: [PortalAuthController],
  providers: [PortalAuthService, PortalAuthGuard, MessageSenderService],
})
export class PortalModule {}
