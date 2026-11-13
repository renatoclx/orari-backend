import { Module } from "@nestjs/common";
import { AutoMessageModule } from "../auto-message/auto-message.module";
import { CompanyAccessModule } from "../company-access/company-access.module";
import { CompanyModule } from "../company/company.module";
import { PortalModule } from "../portal/portal.module";
import { AdminSummaryJob } from "./admin-summary.job";
import { AppointmentNotifierListener } from "./appointment-notifier.listener";
import { NotificationDispatcher } from "./notification-dispatcher.service";
import { NotificationController } from "./notification.controller";
import { NotificationService } from "./notification.service";
import { NotifierCompanies } from "./notifier-companies.service";
import { PendingSummaryController } from "./pending-summary.controller";
import { PendingSummaryService } from "./pending-summary.service";
import { ProfessionalAppointmentListener } from "./professional-appointment.listener";
import { ProfessionalNotifierJob } from "./professional-notifier.job";

// Notificações dos usuários do sistema (o sino): a caixa, as preferências de
// push, o despachante que as fontes usam e a primeira fonte (o que o cliente faz
// pelo app) e as do profissional (o que a clínica faz nos horários dele, o
// lembrete e o resumo da manhã).
@Module({
  imports: [
    CompanyModule,
    CompanyAccessModule,
    PortalModule,
    AutoMessageModule,
  ],
  controllers: [NotificationController, PendingSummaryController],
  providers: [
    NotificationService,
    NotificationDispatcher,
    AppointmentNotifierListener,
    ProfessionalAppointmentListener,
    ProfessionalNotifierJob,
    NotifierCompanies,
    PendingSummaryService,
    AdminSummaryJob,
  ],
  exports: [NotificationDispatcher],
})
export class NotificationModule {}
