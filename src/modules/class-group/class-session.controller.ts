import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { ClassSessionService } from "./class-session.service";
import {
  CreateClassSessionDto,
  UpdateClassSessionDto,
} from "./dto/create-class-session.dto";
import { EnrollClassSessionParticipantDto } from "./dto/enroll-class-participant.dto";

// Sessões de turma: só o ADMIN encaixa alunos (ver docs/turmas.md). O aluno sai
// cancelando o próprio agendamento (PATCH /appointments/:id), como hoje.
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

  // Encaixa um cliente numa sessão que já existe.
  @Post(":id/participants")
  enroll(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: EnrollClassSessionParticipantDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.classSessionService.enroll(id, dto, currentUser.companyId);
  }
}
