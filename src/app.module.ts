import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { validateEnv } from "./config/env.validation";
import { AppService } from "./app.service";
import { AddressModule } from "./modules/address/address.module";
import { AnamnesisModule } from "./modules/anamnesis/anamnesis.module";
import { AppointmentModule } from "./modules/appointment/appointment.module";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BusinessHourModule } from "./modules/business-hour/business-hour.module";
import { ClassGroupModule } from "./modules/class-group/class-group.module";
import { ClientPlanModule } from "./modules/client-plan/client-plan.module";
import { CityModule } from "./modules/city/city.module";
import { CompanyAccessModule } from "./modules/company-access/company-access.module";
import { PortalModule } from "./modules/portal/portal.module";
import { CompanyModule } from "./modules/company/company.module";
import { ContactModule } from "./modules/contact/contact.module";
import { NotificationModule } from "./modules/notification/notification.module";
import { PaymentModule } from "./modules/payment/payment.module";
import { PaymentMethodModule } from "./modules/payment-method/payment-method.module";
import { PeopleModule } from "./modules/people/people.module";
import { PlanModule } from "./modules/plan/plan.module";
import { RecurringAppointmentModule } from "./modules/recurring-appointment/recurring-appointment.module";
import { ServiceModule } from "./modules/service/service.module";
import { StateModule } from "./modules/state/state.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ScheduleModule } from "@nestjs/schedule";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { AutoMessageModule } from "./modules/auto-message/auto-message.module";
import { MessageCampaignModule } from "./modules/message-campaign/message-campaign.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // A API não sobe com configuração ausente ou fraca (ver validateEnv).
      validate: validateEnv,
    }),
    PrismaModule,
    AuditModule,
    AnamnesisModule,
    AuthModule,
    StateModule,
    CityModule,
    CompanyModule,
    CompanyAccessModule,
    PortalModule,
    AutoMessageModule,
    MessageCampaignModule,
    PeopleModule,
    ContactModule,
    AddressModule,
    ServiceModule,
    BusinessHourModule,
    ClassGroupModule,
    // forRoot(0) Inicializa o motor do agendamento uma vez na aplicação quando
    //houver um provider com @Cron()
    ScheduleModule.forRoot(),
    // Anúncios entre módulos (ex.: agendamento marcado → mensagem automática).
    EventEmitterModule.forRoot(),
    AppointmentModule,
    RecurringAppointmentModule,
    NotificationModule,
    PaymentMethodModule,
    PaymentModule,
    PlanModule,
    ClientPlanModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
