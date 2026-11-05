import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { FindAvailabilityQueryDto } from "./dto/find-availability-query.dto";
import { PortalAvailabilityService } from "./portal-availability.service";
import { PortalCatalogService } from "./portal-catalog.service";
import { PortalCompanyService } from "./portal-company.service";
import { PortalDirectoryService } from "./portal-directory.service";

// Vitrine do portal, sem login: a clínica, as regras e os serviços com quem os atende.
@ApiTags("Portal do cliente")
@Public()
@Controller("portal/:slug")
export class PortalCatalogController {
  constructor(
    private readonly portalCompanyService: PortalCompanyService,
    private readonly portalCatalogService: PortalCatalogService,
    private readonly portalAvailabilityService: PortalAvailabilityService,
    private readonly portalDirectoryService: PortalDirectoryService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      "Clínica do portal: nome, logo, segmento, cidade, fuso e regras para o cliente",
    description:
      "`segment` e `city` podem ser nulos. Portal desligado, fora do plano ou clínica inativa: 404.",
  })
  async company(@Param("slug") slug: string) {
    // O id interno da clínica não vai para a vitrine pública.
    const { id, name, logoUrl, segment, timezone, rules } =
      await this.portalCompanyService.findBySlug(slug);
    const city = await this.portalDirectoryService.cityOf(id);
    return { name, logoUrl, segment, city, timezone, rules };
  }

  @Get("services")
  @ApiOperation({
    summary: "Serviços ativos com ao menos um profissional que os atende",
  })
  async services(@Param("slug") slug: string) {
    const company = await this.portalCompanyService.findBySlug(slug);
    return this.portalCatalogService.services(company.id);
  }

  @Get("availability")
  @ApiOperation({
    summary: "Horários livres de um serviço com um profissional, num dia",
    description:
      "Dia no relógio da clínica (AAAA-MM-DD). Respeita o horário de funcionamento, os compromissos e as turmas do profissional, a antecedência mínima e os dias à frente; fora do período, lista vazia. Cada horário traz `time` (HH:MM) e `startAt` (UTC).",
  })
  async availability(
    @Param("slug") slug: string,
    @Query() query: FindAvailabilityQueryDto,
  ) {
    const company = await this.portalCompanyService.findBySlug(slug);
    return this.portalAvailabilityService.findSlots(
      company,
      query.serviceId,
      query.professionalId,
      query.date,
    );
  }
}
