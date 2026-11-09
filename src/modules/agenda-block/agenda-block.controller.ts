import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { AgendaBlockService } from "./agenda-block.service";
import { CreateAgendaBlockDto } from "./dto/create-agenda-block.dto";
import { FindAgendaBlocksQueryDto } from "./dto/find-agenda-blocks-query.dto";

// Bloqueio de horários, com a permissão de Agendamentos: ler = Visualiza,
// bloquear = Cria, desbloquear = Exclui.
@ApiTags("Bloqueio de horários")
@ApiBearerAuth()
@Feature("appointments")
@Controller("agenda-blocks")
export class AgendaBlockController {
  constructor(private readonly agendaBlockService: AgendaBlockService) {}

  @Get()
  @ApiOperation({
    summary: "Horários bloqueados do período",
    description:
      "`from` e `to` em AAAA-MM-DD, no relógio da empresa (as duas pontas entram). Sem `from`, de hoje em diante. Do mais cedo ao mais tarde, com quem bloqueou (`createdBy.name`).",
  })
  findAll(
    @Query() query: FindAgendaBlocksQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.agendaBlockService.findAll(query, currentUser.companyId);
  }

  @Post()
  @ApiOperation({
    summary: "Bloqueia um horário de um dia",
    description:
      "O horário bloqueado conta como fora do funcionamento: só o encaixe entra nele. Fim antes do início ou horário que já começou: 400. Outro bloqueio no horário: 409. Agendamentos no horário sem `confirmed: true`: 409 com `code: AGENDA_BLOCK_HAS_APPOINTMENTS` e `appointments` (eles continuam marcados).",
  })
  create(
    @Body() dto: CreateAgendaBlockDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.agendaBlockService.create(dto, currentUser, ip);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({
    summary: "Desbloqueia",
    description: "Bloqueio que já terminou: 400.",
  })
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.agendaBlockService.remove(id, currentUser, ip);
  }
}
