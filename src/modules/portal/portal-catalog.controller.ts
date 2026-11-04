import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { PortalCatalogService } from "./portal-catalog.service";
import { PortalCompanyService } from "./portal-company.service";

// Vitrine do portal, sem login: a clínica, as regras e os serviços com quem os atende.
@ApiTags("Portal do cliente")
@Public()
@Controller("portal/:slug")
export class PortalCatalogController {
  constructor(
    private readonly portalCompanyService: PortalCompanyService,
    private readonly portalCatalogService: PortalCatalogService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Clínica do portal: nome, logo, fuso e regras para o cliente",
    description: "Portal desligado, fora do plano ou clínica inativa: 404.",
  })
  async company(@Param("slug") slug: string) {
    // O id interno da clínica não vai para a vitrine pública.
    const { name, logoUrl, timezone, rules } =
      await this.portalCompanyService.findBySlug(slug);
    return { name, logoUrl, timezone, rules };
  }

  @Get("services")
  @ApiOperation({
    summary: "Serviços ativos com ao menos um profissional que os atende",
  })
  async services(@Param("slug") slug: string) {
    const company = await this.portalCompanyService.findBySlug(slug);
    return this.portalCatalogService.services(company.id);
  }
}
