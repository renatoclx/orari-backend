import { Module } from "@nestjs/common";
import { CompanyAccessModule } from "../company-access/company-access.module";
import { PortalModule } from "../portal/portal.module";
import { AutoMessageController } from "./auto-message.controller";
import { AutoMessageJob } from "./auto-message.job";
import { AutoMessageListener } from "./auto-message.listener";
import { AutoMessageSender } from "./auto-message-sender.service";
import { AutoMessageService } from "./auto-message.service";

// Mensagens automáticas ao cliente do app. Os agendamentos não dependem deste
// módulo: ele escuta os anúncios deles (common/events/appointment-events.ts).
@Module({
  imports: [PortalModule, CompanyAccessModule],
  controllers: [AutoMessageController],
  providers: [
    AutoMessageService,
    AutoMessageSender,
    AutoMessageListener,
    AutoMessageJob,
  ],
})
export class AutoMessageModule {}
