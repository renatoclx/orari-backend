import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { ClassSessionService } from "./class-session.service";
import { CancelClassSessionDto } from "./dto/cancel-class-session.dto";
import {
  CreateClassSessionDto,
  UpdateClassSessionDto,
} from "./dto/create-class-session.dto";
import { EnrollClassSessionParticipantDto } from "./dto/enroll-class-participant.dto";
import { FindClassSessionsQueryDto } from "./dto/find-class-sessions-query.dto";

// Sessões de turma: só o ADMIN encaixa alunos e cancela a sessão (ver
// docs/turmas.md). O aluno avulso sai cancelando o próprio agendamento
// (PATCH /appointments/:id), como hoje.
@ApiTags("Turmas")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Controller("class-sessions")
export class ClassSessionController {
  constructor(private readonly classSessionService: ClassSessionService) {}

  // Agendamento que vira turma (sessão avulsa).
  @Post()
  create(
    @Body() dto: CreateClassSessionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.classSessionService.create(dto, currentUser.companyId);
  }

  // Agenda por sessão (até 31 dias): sessões e horários vazios das turmas fixas.
  @Get()
  findAll(
    @Query() query: FindClassSessionsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.classSessionService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.classSessionService.findOne(id, currentUser.companyId);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassSessionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.classSessionService.update(id, dto, currentUser.companyId);
  }

  // Cancela a sessão inteira (antes do início): os agendamentos dos alunos e os
  // pagamentos pendentes deles são cancelados.
  @Patch(":id/cancel")
  cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CancelClassSessionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.classSessionService.cancel(id, dto, currentUser.companyId);
  }

  // Encaixa um ou mais clientes numa sessão que já existe, tudo ou nada; devolve a sessão.
  @Post(":id/participants")
  enroll(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: EnrollClassSessionParticipantDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.classSessionService.enroll(id, dto, currentUser.companyId);
  }
}
