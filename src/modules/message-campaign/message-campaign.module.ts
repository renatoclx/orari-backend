import { Module } from "@nestjs/common";
import { AutoMessageModule } from "../auto-message/auto-message.module";
import { PortalModule } from "../portal/portal.module";
import { MessageCampaignController } from "./message-campaign.controller";
import { MessageCampaignService } from "./message-campaign.service";

// Mensagens → Enviar: a clínica escreve e envia a todos os clientes com o app.
@Module({
  imports: [PortalModule, AutoMessageModule],
  controllers: [MessageCampaignController],
  providers: [MessageCampaignService],
})
export class MessageCampaignModule {}
