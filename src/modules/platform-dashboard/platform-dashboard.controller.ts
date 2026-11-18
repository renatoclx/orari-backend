import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { PlatformDashboardService } from "./platform-dashboard.service";

// Painel da plataforma: só o SUPER_ADMIN.
@ApiTags("Painel da plataforma")
@ApiBearerAuth()
@Roles(UserType.SUPER_ADMIN)
@Controller("platform/dashboard")
export class PlatformDashboardController {
  constructor(private readonly service: PlatformDashboardService) {}

  @Get()
  @ApiOperation({
    summary: "Receita, situação das empresas, crescimento, atenção e uso",
    description:
      "Empresas ativas, menos a da plataforma. MRR: equivalente mensal das " +
      "assinaturas ativas e em atraso, com o desconto vigente. Meses no fuso " +
      "de Brasília; agendamentos contados pela criação.",
  })
  find(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.service.build(currentUser);
  }
}
