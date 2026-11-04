import { Module } from "@nestjs/common";
import { CompanyAccessModule } from "../company-access/company-access.module";
import { PeopleModule } from "../people/people.module";
import { MessageSenderService } from "./message-sender.service";
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
  imports: [PeopleModule, CompanyAccessModule],
  controllers: [
    PortalAuthController,
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
    PortalSettingsService,
  ],
})
export class PortalModule {}
