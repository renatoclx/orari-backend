import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import { ProfessionalApp } from "../../common/decorators/professional-app.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { FindProfessionalAgendaQueryDto } from "./dto/find-professional-agenda-query.dto";
import { ProfessionalAppService } from "./professional-app.service";

// Rotas do app do profissional: só ele as acessa (@Roles) e só elas ficam
// abertas a ele (@ProfessionalApp).
@ApiTags("App do profissional")
@ApiBearerAuth()
@Feature("professional-app")
@ProfessionalApp()
@Roles(UserType.PROFESSIONAL)
@Controller("professional-app")
export class ProfessionalAppController {
  constructor(private readonly professionalApp: ProfessionalAppService) {}

  @Get("agenda")
  @ApiOperation({
    summary: "Agenda do dia do próprio profissional",
    description:
      "Atendimentos do profissional logado e bloqueios do dia, sem dados de " +
      "pagamento. O dia (AAAA-MM-DD) é o do relógio da empresa; sem ele, hoje.",
  })
  findAgenda(
    @Query() { day }: FindProfessionalAgendaQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.professionalApp.findAgenda(currentUser, day);
  }
}
