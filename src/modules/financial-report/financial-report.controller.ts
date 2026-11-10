import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import {
  FinancialReportPaymentsQueryDto,
  FinancialReportQueryDto,
} from "./dto/financial-report-query.dto";
import { FinancialReportService } from "./financial-report.service";

// Relatório "Financeiro": o que entrou no caixa. Só leitura, restrito à
// empresa do usuário. Só o ADMIN.
@ApiTags("Relatório financeiro")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("financial-report")
@Controller("financial-report")
export class FinancialReportController {
  constructor(
    private readonly financialReportService: FinancialReportService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Resumo do recebido no período",
    description:
      "Pagamentos PAID, não excluídos, com data de pagamento no período (`from`, `to`, AAAA-MM-DD no fuso da empresa, pontas incluídas; padrão: mês atual). `paymentMethodId` opcional (404 se não for da empresa). `received` (total), `appointments` e `packages` (origem do pagamento), `series` (por dia até 62 dias, senão por semana) e `byMethod` (do maior valor para o menor, com `share` de 0 a 1; `id` null para pagamento sem método). Valores em texto com duas casas.",
  })
  report(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: FinancialReportQueryDto,
  ) {
    return this.financialReportService.report(query, currentUser.companyId);
  }

  @Get("payments")
  @ApiOperation({
    summary: "Extrato do recebido (paginado)",
    description:
      "Os mesmos pagamentos do resumo, do mais recente para o mais antigo: data, valor, origem (`appointment` ou `package`), descrição (serviço ou pacote), cliente e método.",
  })
  payments(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: FinancialReportPaymentsQueryDto,
  ) {
    return this.financialReportService.payments(query, currentUser.companyId);
  }
}
