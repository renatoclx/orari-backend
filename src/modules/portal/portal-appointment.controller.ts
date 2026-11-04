import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { CurrentClient } from "./current-client.decorator";
import { BookAppointmentDto } from "./dto/book-appointment.dto";
import { PortalAppointmentService } from "./portal-appointment.service";
import { PortalAuthGuard } from "./portal-auth.guard";
import type { PortalClient } from "./portal-auth.service";
import { PortalCompanyService } from "./portal-company.service";

// Agendamentos do cliente entrado no portal (token do portal, não o da clínica).
@ApiTags("Portal do cliente")
@ApiBearerAuth()
@Public()
@UseGuards(PortalAuthGuard)
@Controller("portal/:slug/appointments")
export class PortalAppointmentController {
  constructor(
    private readonly portalCompanyService: PortalCompanyService,
    private readonly portalAppointmentService: PortalAppointmentService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Próximos agendamentos e os últimos passados do cliente",
    description:
      "Cada item traz `kind` (SINGLE, RECURRENCE, PLAN ou CLASS) e `canCancel` (avulso, aberto e dentro do prazo da clínica).",
  })
  async list(
    @Param("slug") slug: string,
    @CurrentClient() client: PortalClient,
  ) {
    const company = await this.portalCompanyService.findBySlug(slug);
    return this.portalAppointmentService.list(company, client);
  }

  @Post()
  @ApiOperation({
    summary: "Agenda um avulso num dos horários livres",
    description:
      "O `startAt` precisa estar na lista de horários livres no momento do pedido (senão, 409). A origem fica PORTAL.",
  })
  async book(
    @Param("slug") slug: string,
    @Body() dto: BookAppointmentDto,
    @CurrentClient() client: PortalClient,
  ) {
    const company = await this.portalCompanyService.findBySlug(slug);
    return this.portalAppointmentService.book(company, client, dto);
  }

  @Patch(":id/cancel")
  @HttpCode(204)
  @ApiOperation({
    summary: "Cancela um avulso do cliente, dentro do prazo da clínica",
    description:
      "Recorrência, pacote e turma: 400 (são canceladas pela clínica). Fora do prazo: 400.",
  })
  async cancel(
    @Param("slug") slug: string,
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentClient() client: PortalClient,
  ) {
    const company = await this.portalCompanyService.findBySlug(slug);
    await this.portalAppointmentService.cancel(company, client, id);
  }
}
