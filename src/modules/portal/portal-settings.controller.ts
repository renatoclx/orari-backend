import { Body, Controller, Get, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { UpdatePortalSettingsDto } from "./dto/update-portal-settings.dto";
import { PortalSettingsService } from "./portal-settings.service";

// Regras do portal da própria clínica: só o ADMIN e com o portal no plano.
@ApiTags("Portal do cliente (clínica)")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("client-portal")
@Controller("portal-settings")
export class PortalSettingsController {
  constructor(private readonly portalSettingsService: PortalSettingsService) {}

  @Get()
  @ApiOperation({ summary: "Regras do portal (padrão: desligado)" })
  find(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.portalSettingsService.find(currentUser.companyId);
  }

  @Put()
  @ApiOperation({ summary: "Liga ou desliga o portal e muda as regras" })
  replace(
    @Body() dto: UpdatePortalSettingsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.portalSettingsService.replace(currentUser.companyId, dto);
  }
}
