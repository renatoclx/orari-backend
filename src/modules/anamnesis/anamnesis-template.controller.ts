import {
  Body,
  Controller,
  Get,
  Ip,
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
import { AnamnesisTemplateService } from "./anamnesis-template.service";
import { CreateAnamnesisTemplateDto } from "./dto/create-anamnesis-template.dto";
import { FindAnamnesisTemplatesQueryDto } from "./dto/find-anamnesis-templates-query.dto";
import { UpdateAnamnesisTemplateDto } from "./dto/update-anamnesis-template.dto";

// Sem DELETE: o modelo é inativado por isActive (ver business-rules.md).
@ApiTags("Anamnese - Modelos")
@ApiBearerAuth()
@Controller("anamnesis-templates")
export class AnamnesisTemplateController {
  constructor(private readonly templateService: AnamnesisTemplateService) {}

  // Só o ADMIN cria e edita modelos.
  @Roles(UserType.ADMIN)
  @Post()
  create(
    @Body() dto: CreateAnamnesisTemplateDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.templateService.create(dto, currentUser, ip);
  }

  // A leitura vale para quem tem acesso à anamnese (conferido no service: depende do vínculo com o profissional).
  @Get()
  findAll(
    @Query() query: FindAnamnesisTemplatesQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.templateService.findAll(query, currentUser);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.templateService.findOne(id, currentUser);
  }

  @Roles(UserType.ADMIN)
  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAnamnesisTemplateDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.templateService.update(id, dto, currentUser, ip);
  }
}
