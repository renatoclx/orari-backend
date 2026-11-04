import { Module } from "@nestjs/common";
import { AppointmentModule } from "../appointment/appointment.module";
import { CompanyAccessModule } from "../company-access/company-access.module";
import { PeopleModule } from "../people/people.module";
import { MessageSenderService } from "./message-sender.service";
import { PortalAppointmentController } from "./portal-appointment.controller";
import { PortalAppointmentService } from "./portal-appointment.service";
import { PortalAuthController } from "./portal-auth.controller";
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
    PortalAuthController,
    PortalAppointmentController,
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
    PortalSettingsService,
  ],
})
export class PortalModule {}
