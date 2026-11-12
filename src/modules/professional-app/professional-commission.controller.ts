import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import { ProfessionalApp } from "../../common/decorators/professional-app.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import {
  ProfessionalClosingListQueryDto,
  ProfessionalCommissionListQueryDto,
  ProfessionalCommissionSummaryQueryDto,
} from "./dto/find-professional-commissions-query.dto";
import { ProfessionalCommissionService } from "./professional-commission.service";

// Comissões do próprio profissional (só consulta). A funcionalidade
// `commissions` da empresa também é exigida, no service.
@ApiTags("App do profissional")
@ApiBearerAuth()
@Feature("professional-app")
@ProfessionalApp()
@Roles(UserType.PROFESSIONAL)
@Controller("professional-app")
export class ProfessionalCommissionController {
  constructor(private readonly commission: ProfessionalCommissionService) {}

  @Get("commissions/summary")
  @ApiOperation({
    summary: "Resumo das comissões do próprio profissional no mês",
    description:
      "Quantidade, base e comissão do mês (pela data do atendimento) e, sem " +
      "depender do mês, o adiantado e o a receber. Sem o que o cliente pagou.",
  })
  findSummary(
    @Query() query: ProfessionalCommissionSummaryQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.commission.summary(currentUser, query);
  }

  @Get("commissions")
  @ApiOperation({
    summary: "Comissões do mês, atendimento a atendimento",
    description: "Do mais recente para o mais antigo, 10 por página.",
  })
  findCommissions(
    @Query() query: ProfessionalCommissionListQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.commission.list(currentUser, query);
  }

  @Get("commission-closings")
  @ApiOperation({
    summary: "Fechamentos de comissão do próprio profissional",
    description: "Do número maior para o menor, 10 por página.",
  })
  findClosings(
    @Query() query: ProfessionalClosingListQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.commission.listClosings(currentUser, query);
  }

  @Get("commission-closings/:id")
  @ApiOperation({
    summary: "Recibo de um fechamento do próprio profissional",
    description: "Fechamento de outro profissional: 404.",
  })
  findClosing(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.commission.receipt(currentUser, id);
  }
}
