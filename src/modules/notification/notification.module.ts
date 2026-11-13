import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { PortalModule } from "../portal/portal.module";
import { AppointmentNotifierListener } from "./appointment-notifier.listener";
import { NotificationDispatcher } from "./notification-dispatcher.service";
import { NotificationController } from "./notification.controller";
import { NotificationService } from "./notification.service";

// Notificações dos usuários do sistema (o sino): a caixa, as preferências de
// push, o despachante que as fontes usam e a primeira fonte (o que o cliente faz
// pelo app).
@Module({
  imports: [CompanyModule, PortalModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationDispatcher,
    AppointmentNotifierListener,
  ],
  exports: [NotificationDispatcher],
})
export class NotificationModule {}
