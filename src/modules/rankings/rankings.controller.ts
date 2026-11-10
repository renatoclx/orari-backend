import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { RankingsQueryDto } from "./dto/rankings-query.dto";
import { RankingsService } from "./rankings.service";

// Relatório "Rankings": só leitura, restrito à empresa do usuário. Só o ADMIN.
@ApiTags("Rankings")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("rankings")
@Controller("rankings")
export class RankingsController {
  constructor(private readonly rankingsService: RankingsService) {}

  @Get()
  @ApiOperation({
    summary: "Rankings de serviços, profissionais e clientes no período",
    description:
      "Período em dias da empresa (`from`, `to`, AAAA-MM-DD, pontas incluídas; padrão: mês atual). Base: atendimentos COMPLETED no período (pelo início) e o pagamento próprio deles (PAID ou PENDING, não excluído): `amount` é o faturado, `completed` a quantidade (sessões de pacote contam aqui, sem valor) e `average` = faturado ÷ concluídos com pagamento (null sem nenhum). Clientes somam também os pacotes contratados no período (`packages`: pagamentos PAID ou PENDING da contratação). Listas inteiras, ordenadas por `sort` (`amount`, padrão, ou `count`); empate pelo nome. Valores em texto com duas casas.",
  })
  rankings(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: RankingsQueryDto,
  ) {
    return this.rankingsService.rankings(query, currentUser.companyId);
  }
}
