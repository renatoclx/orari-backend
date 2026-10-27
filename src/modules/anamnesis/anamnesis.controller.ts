import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { AnamnesisService } from "./anamnesis.service";
import { CreateAnamnesisEntryDto } from "./dto/create-anamnesis-entry.dto";
import { CreateAnamnesisDto } from "./dto/create-anamnesis.dto";
import { FindAnamnesesQueryDto } from "./dto/find-anamneses-query.dto";

// Sem PATCH nem DELETE: os registros são imutáveis (ver business-rules.md). O
// acesso (ADMIN ou profissional vinculado) é conferido no service, pois depende
// do vínculo, e não do tipo do usuário.
@ApiTags("Anamnese")
@ApiBearerAuth()
@Controller("anamnesis")
export class AnamnesisController {
  constructor(private readonly anamnesisService: AnamnesisService) {}

  @Post()
  create(
    @Body() dto: CreateAnamnesisDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    // Registrado na auditoria.
    @Ip() ip: string,
  ) {
    return this.anamnesisService.create(dto, currentUser, ip);
  }

  @Get()
  findByClient(
    @Query() query: FindAnamnesesQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.anamnesisService.findByClient(query, currentUser, ip);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.anamnesisService.findOne(id, currentUser, ip);
  }

  // Acompanhamento de uma consulta (a ficha só cresce: nada é editado ou removido).
  @Post(":id/entries")
  addEntry(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateAnamnesisEntryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.anamnesisService.addEntry(id, dto, currentUser, ip);
  }
}
