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
import { ClassGroupService } from "./class-group.service";
import { CreateClassGroupDto } from "./dto/create-class-group.dto";
import { FindClassGroupsQueryDto } from "./dto/find-class-groups-query.dto";
import { UpdateClassGroupDto } from "./dto/update-class-group.dto";

// Só o ADMIN gerencia turmas (ver docs/turmas.md). Sem DELETE: a turma é inativada por isActive.
@ApiTags("Turmas")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Controller("class-groups")
export class ClassGroupController {
  constructor(private readonly classGroupService: ClassGroupService) {}

  @Post()
  create(
    @Body() dto: CreateClassGroupDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.classGroupService.create(dto, currentUser.companyId);
  }

  @Get()
  findAll(
    @Query() query: FindClassGroupsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.classGroupService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.classGroupService.findOne(id, currentUser.companyId);
  }

  // Altera só nome, vagas e situação; serviço, profissional e dias não mudam.
  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassGroupDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.classGroupService.update(id, dto, currentUser.companyId);
  }
}
