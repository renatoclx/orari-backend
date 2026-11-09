import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { ReceivablesDebtorsQueryDto } from "./dto/receivables-debtors-query.dto";
import { ReceivablesQueryDto } from "./dto/receivables-query.dto";
import { ReceivablesService } from "./receivables.service";

// Relatório "Contas a receber": só leitura, restrito à empresa do usuário.
// Só o ADMIN, como os demais relatórios (números financeiros da empresa).
@ApiTags("Contas a receber")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("receivables")
@Controller("receivables")
export class ReceivablesController {
  constructor(private readonly receivablesService: ReceivablesService) {}

  @Get()
  @ApiOperation({
    summary: "Resumo do contas a receber",
    description:
      "Hoje: `open` (todo pendente, com ou sem vencimento), `overdue` (pendente vencido, com a quantidade de clientes) e `aging` (o atrasado por idade: 1–30, 31–60, 61–90 e mais de 90 dias). No período (`from`, `to`, AAAA-MM-DD, pontas incluídas; padrão: mês atual): `received` (pago com data de pagamento no período) e `default` (do que venceu no período até ontem, o que segue pendente; `rate` de 0 a 1, null sem nada vencido). `months`: os 6 meses até o atual e os 3 seguintes, pelo vencimento, com pago, atrasado e a vencer. Cancelados e excluídos ficam de fora.",
  })
  summary(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ReceivablesQueryDto,
  ) {
    return this.receivablesService.summary(query, currentUser.companyId);
  }

  @Get("debtors")
  @ApiOperation({
    summary: "Clientes com pagamento atrasado (paginado)",
    description:
      "Um item por cliente com pendente vencido: valor e quantidade em atraso e o vencimento mais antigo. Ordem: maior valor em atraso primeiro. `search` filtra pelo nome.",
  })
  debtors(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ReceivablesDebtorsQueryDto,
  ) {
    return this.receivablesService.debtors(query, currentUser.companyId);
  }
}
