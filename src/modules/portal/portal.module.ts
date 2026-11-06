import { Module } from "@nestjs/common";
import { StorageModule } from "../../common/storage/storage.module";
import { AppointmentModule } from "../appointment/appointment.module";
import { CompanyAccessModule } from "../company-access/company-access.module";
import { PeopleModule } from "../people/people.module";
import { ClientNotifierService } from "./client-notifier.service";
import { MessageSenderService } from "./message-sender.service";
import {
  PortalAccessLinkController,
  PortalAccessUseController,
  PortalClientConfirmController,
} from "./portal-access.controller";
import { PortalAccountController } from "./portal-account.controller";
import { PortalAccessService } from "./portal-access.service";
import { PortalAppointmentController } from "./portal-appointment.controller";
import { PortalAppointmentService } from "./portal-appointment.service";
import { PortalAuthGuard } from "./portal-auth.guard";
import { PortalAuthService } from "./portal-auth.service";
import { PortalAvailabilityService } from "./portal-availability.service";
import { PortalCatalogController } from "./portal-catalog.controller";
import { PortalCatalogService } from "./portal-catalog.service";
import { PortalCompanyService } from "./portal-company.service";
import { PortalDirectoryController } from "./portal-directory.controller";
import { PortalDirectoryService } from "./portal-directory.service";
import { PortalPlaceService } from "./portal-place.service";
import { PortalProfileService } from "./portal-profile.service";
import { PortalPushController } from "./portal-push.controller";
import { PortalPushService } from "./portal-push.service";
import { PushSenderService } from "./push-sender.service";
import { PortalSettingsController } from "./portal-settings.controller";
import { PortalSettingsService } from "./portal-settings.service";

@Module({
  imports: [
    PeopleModule,
    CompanyAccessModule,
    AppointmentModule,
    StorageModule,
  ],
  controllers: [
    PortalAccountController,
    PortalAppointmentController,
    PortalAccessLinkController,
    PortalAccessUseController,
    PortalClientConfirmController,
    PortalCatalogController,
    PortalDirectoryController,
    PortalSettingsController,
    PortalPushController,
  ],
  providers: [
    PortalAuthService,
    PortalAuthGuard,
    MessageSenderService,
    PortalCompanyService,
    PortalCatalogService,
    PortalAvailabilityService,
    PortalAppointmentService,
    PortalAccessService,
    PortalSettingsService,
    PortalPlaceService,
    PortalDirectoryService,
    PortalProfileService,
    PushSenderService,
    ClientNotifierService,
    PortalPushService,
  ],
  // Os avisos automáticos e as mensagens da clínica (módulo Mensagens) usam o
  // mesmo ponto de envio.
  exports: [ClientNotifierService],
})
export class PortalModule {}
