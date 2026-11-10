import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { ClientsReportService } from "./clients-report.service";
import {
  ClientsBirthdaysQueryDto,
  ClientsReportQueryDto,
} from "./dto/clients-report-query.dto";

// Relatório "Perfil do cliente": só leitura, restrito à empresa do usuário.
// Só o ADMIN, como os demais relatórios.
@ApiTags("Perfil do cliente")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("clients-report")
@Controller("clients-report")
export class ClientsReportController {
  constructor(private readonly clientsReportService: ClientsReportService) {}

  @Get()
  @ApiOperation({
    summary: "Perfil dos clientes da empresa",
    description:
      'Sobre os clientes ativos no cadastro. Hoje: `active` (concluído nos últimos 60 dias ou com agendamento futuro), `lapsed` (o resto), `withApp`, `ages` (faixas de idade, `key` null sem data de nascimento) e `cities` (as 5 mais comuns pelo endereço principal, "Outras" e null sem endereço). No período (`from`, `to`, AAAA-MM-DD no fuso da empresa; padrão: mês atual): `newClients` (primeiro concluído na empresa no período), `attended`, `frequency` (concluídos ÷ atendidos), `kinds` (clientes por tipo: avulso, recorrência, pacote, turma; não exclusivos) e `sources` (concluídos agendados pela clínica ou pelo app). `share` de 0 a 1.',
  })
  report(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ClientsReportQueryDto,
  ) {
    return this.clientsReportService.report(query, currentUser.companyId);
  }

  @Get("birthdays")
  @ApiOperation({
    summary: "Aniversariantes do período (paginado)",
    description:
      "Clientes ativos no cadastro com aniversário no período (padrão: mês atual), pela data do aniversário: data de nascimento, o aniversário no período, a idade que completa e o celular principal. Quem nasceu em 29/02 comemora em 28/02 nos anos não bissextos.",
  })
  birthdays(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ClientsBirthdaysQueryDto,
  ) {
    return this.clientsReportService.birthdays(query, currentUser.companyId);
  }
}
