import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import {
  PackagesEndingQueryDto,
  PackagesReportQueryDto,
} from "./dto/packages-report-query.dto";
import { PackagesReportService } from "./packages-report.service";

// Relatório "Pacotes": a vida das contratações. Só leitura, restrito à
// empresa do usuário. Só o ADMIN.
@ApiTags("Relatório de pacotes")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("packages-report")
@Controller("packages-report")
export class PackagesReportController {
  constructor(private readonly packagesReportService: PackagesReportService) {}

  @Get()
  @ApiOperation({
    summary: "Resumo das contratações de pacote",
    description:
      "No período (`from`, `to`, AAAA-MM-DD no fuso da empresa, pontas incluídas; padrão: mês atual): `created` (contratações novas, pela data de criação, e o valor contratado) e `cancelled` (pela data do cancelamento). Hoje: `active` (não canceladas e com fim de hoje em diante, inclusive as que ainda vão começar) e `ending` (ativas com fim nos próximos 30 dias, sem outra ativa do mesmo cliente terminando depois). `byPlan`: os mesmos números por pacote, do maior valor contratado para o menor.",
  })
  report(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: PackagesReportQueryDto,
  ) {
    return this.packagesReportService.report(query, currentUser.companyId);
  }

  @Get("ending")
  @ApiOperation({
    summary: "Contratações terminando em breve (paginado)",
    description:
      "As de `ending`, do fim mais próximo ao mais distante: cliente (com o celular principal), pacote, data final e as sessões (`completed` de `total`, sem as canceladas).",
  })
  ending(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: PackagesEndingQueryDto,
  ) {
    return this.packagesReportService.ending(query, currentUser.companyId);
  }
}
