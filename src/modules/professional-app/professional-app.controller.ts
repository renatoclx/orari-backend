import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import { ProfessionalApp } from "../../common/decorators/professional-app.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { FindProfessionalAgendaQueryDto } from "./dto/find-professional-agenda-query.dto";
import { FindProfessionalClientsQueryDto } from "./dto/find-professional-clients-query.dto";
import { ProfessionalClientsService } from "./professional-clients.service";
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
  constructor(
    private readonly professionalApp: ProfessionalAppService,
    private readonly clients: ProfessionalClientsService,
  ) {}

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

  @Get("clients")
  @ApiOperation({
    summary: "Clientes do próprio profissional",
    description:
      "Clientes ativos com ao menos um agendamento não cancelado com o " +
      "profissional logado, em ordem alfabética, com nome, foto, telefone " +
      "principal, último atendimento concluído e próximo agendamento. " +
      "Sem dados de pagamento. Filtro opcional por nome (search).",
  })
  findClients(
    @Query() query: FindProfessionalClientsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.clients.findAll(currentUser, query);
  }

  @Get("clients/:id")
  @ApiOperation({
    summary: "Ficha de um cliente do próprio profissional",
    description:
      "O cliente e os atendimentos mais recentes dele com o profissional " +
      "logado. Cliente de outro profissional: 404.",
  })
  findClient(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.clients.findOne(currentUser, id);
  }
}
