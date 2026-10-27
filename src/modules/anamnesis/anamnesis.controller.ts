import {
  Body,
  Controller,
  Get,
  Header,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { AnamnesisPdfService } from "./anamnesis-pdf.service";
import { AnamnesisService } from "./anamnesis.service";
import { CreateAnamnesisEntryDto } from "./dto/create-anamnesis-entry.dto";
import { CreateAnamnesisDto } from "./dto/create-anamnesis.dto";
import { FindAnamnesesQueryDto } from "./dto/find-anamneses-query.dto";
import { FindEntryAppointmentsQueryDto } from "./dto/find-entry-appointments-query.dto";
import { FindAnamnesisPdfQueryDto } from "./dto/find-anamnesis-pdf-query.dto";

// Sem PATCH nem DELETE: os registros são imutáveis (ver business-rules.md). O
// acesso (ADMIN ou profissional vinculado) é conferido no service, pois depende
// do vínculo, e não do tipo do usuário.
@ApiTags("Anamnese")
@ApiBearerAuth()
@Controller("anamnesis")
export class AnamnesisController {
  constructor(
    private readonly anamnesisService: AnamnesisService,
    private readonly pdfService: AnamnesisPdfService,
  ) {}

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

  // Usada pela agenda (cartão de hover). Declarada antes de ":id", senão "appointments-with-entry" seria lido como id.
  @Get("appointments-with-entry")
  findAppointmentsWithEntry(
    @Query() query: FindEntryAppointmentsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.anamnesisService.findAppointmentsWithEntry(query, currentUser);
  }

  // Dado de saúde: o arquivo não pode ficar em cache de navegador nem de proxy. O
  // nome é genérico de propósito (cabeçalhos e logs não levam dado pessoal).
  @Get(":id/pdf")
  @Header("Cache-Control", "no-store")
  async pdf(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: FindAnamnesisPdfQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    const pdf = await this.pdfService.generate(id, query, currentUser, ip);
    const day = new Date().toISOString().slice(0, 10);

    return new StreamableFile(pdf, {
      type: "application/pdf",
      disposition: `inline; filename="ficha-anamnese-${day}.pdf"`,
    });
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
