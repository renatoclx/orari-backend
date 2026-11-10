import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CommissionService } from "./commission.service";
import {
  CommissionListQueryDto,
  CommissionSummaryQueryDto,
} from "./dto/commission-query.dto";

// Comissões dos profissionais: remuneração, então só o ADMIN, restrito à
// empresa do usuário. Por ora só consulta (adiantamento e fechamento depois).
@ApiTags("Comissões")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("commissions")
@Controller("commissions")
export class CommissionController {
  constructor(private readonly commissionService: CommissionService) {}

  @Get("summary")
  @ApiOperation({
    summary: "Totais das comissões no período",
    description:
      "Pela data do atendimento (`from`, `to`, AAAA-MM-DD no fuso da empresa; padrão: mês atual); `professionalId` opcional (404 se não for profissional da empresa). Quantidade, base, comissão e `clientPaid` (quanto da base os clientes já pagaram: avulso pago = a base; sessão de pacote = a base na proporção do que a contratação recebeu), no total e por profissional.",
  })
  summary(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: CommissionSummaryQueryDto,
  ) {
    return this.commissionService.summary(query, currentUser.companyId);
  }

  @Get()
  @ApiOperation({
    summary: "Comissões atendimento a atendimento (paginado)",
    description:
      "Os mesmos filtros, do atendimento mais recente para o mais antigo: atendimento (data, cliente, serviço, se é sessão de pacote), profissional, base, regra, valor e o pago pelo cliente.",
  })
  list(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: CommissionListQueryDto,
  ) {
    return this.commissionService.list(query, currentUser.companyId);
  }
}
