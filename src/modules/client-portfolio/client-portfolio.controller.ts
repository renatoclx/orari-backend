import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { ClientPortfolioService } from "./client-portfolio.service";
import { ClientPortfolioClientsQueryDto } from "./dto/client-portfolio-clients-query.dto";
import { ClientPortfolioQueryDto } from "./dto/client-portfolio-query.dto";

// Relatório "Carteira de clientes": só leitura, restrito à empresa do usuário.
@ApiTags("Carteira de clientes")
@ApiBearerAuth()
@Feature("client-portfolio")
@Controller("client-portfolio")
export class ClientPortfolioController {
  constructor(
    private readonly clientPortfolioService: ClientPortfolioService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Resumo da carteira do profissional no período",
    description:
      "Período em dias da empresa (`from`, `to`, AAAA-MM-DD, pontas incluídas; padrão: mês atual). `clients`: clientes ativos com algum agendamento não cancelado com o profissional; `newClients`: primeiro atendimento concluído no período; `lapsedClients`: sem atendimento concluído há mais de 60 dias e sem agendamento futuro; `completed` e `packageSessions`: concluídos no período (sessões de pacote à parte, sem valor); `received`/`pending`: pagamentos dos concluídos no período; `averageTicket`: (recebido + pendente) ÷ concluídos com pagamento (null sem nenhum). Profissional de outra empresa: 404.",
  })
  summary(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ClientPortfolioQueryDto,
  ) {
    return this.clientPortfolioService.summary(query, currentUser.companyId);
  }

  @Get("clients")
  @ApiOperation({
    summary: "Clientes da carteira do profissional (paginado)",
    description:
      "Mesmos `professionalId`, `from` e `to` do resumo, mais `status` (NEW, ACTIVE, LAPSED), `search` (nome) e `page`/`limit`. Cada item: situação, último atendimento concluído (data e serviço), próximo agendamento, concluídos no período e `pending` (em aberto com o profissional, qualquer vencimento). Ordem: quem precisa de contato primeiro (último atendimento mais antigo); quem só tem agendamento futuro vai para o fim.",
  })
  clients(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ClientPortfolioClientsQueryDto,
  ) {
    return this.clientPortfolioService.clients(query, currentUser.companyId);
  }
}
