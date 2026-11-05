import { Module } from "@nestjs/common";
import { AppointmentModule } from "../appointment/appointment.module";
import { CompanyAccessModule } from "../company-access/company-access.module";
import { PeopleModule } from "../people/people.module";
import { MessageSenderService } from "./message-sender.service";
import {
  PortalAccessLinkController,
  PortalAccessUseController,
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
import { PortalSettingsController } from "./portal-settings.controller";
import { PortalSettingsService } from "./portal-settings.service";

@Module({
  imports: [PeopleModule, CompanyAccessModule, AppointmentModule],
  controllers: [
    PortalAccountController,
    PortalAppointmentController,
    PortalAccessLinkController,
    PortalAccessUseController,
    PortalCatalogController,
    PortalSettingsController,
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
  ],
})
export class PortalModule {}
