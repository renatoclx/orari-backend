import {
  Body,
  Controller,
  Headers,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import {
  Feature,
  FeatureAction,
} from "../../common/decorators/feature.decorator";
import { Public } from "../../common/decorators/public.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { ExchangeLinkDto } from "./dto/exchange-link.dto";
import { PortalAccessService } from "./portal-access.service";

// A clínica gera o link de acesso ao portal na ficha do cliente.
@ApiTags("Portal do cliente (clínica)")
@ApiBearerAuth()
@Controller("people/:id/portal-access")
export class PortalAccessLinkController {
  constructor(private readonly portalAccessService: PortalAccessService) {}

  @Post()
  @Feature("clients")
  @FeatureAction("edit")
  @ApiOperation({
    summary: "Gera o link de acesso ao portal para o cliente (24 h, uso único)",
    description:
      "Para a clínica enviar pelo WhatsApp dela ou mostrar em QR code. Um link novo invalida o anterior não usado. Portal desligado: 409. Fica na auditoria.",
  })
  create(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.portalAccessService.createLink(id, currentUser, ip);
  }
}

// O cliente abre o link e entra, sem código.
@ApiTags("Portal do cliente")
@Public()
@Controller("portal/:slug/auth")
export class PortalAccessExchangeController {
  constructor(private readonly portalAccessService: PortalAccessService) {}

  @Post("link")
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse({ description: "Tentativas demais; aguarde." })
  @ApiOperation({
    summary: "Troca o link de acesso da clínica por uma sessão de 90 dias",
  })
  exchange(
    @Param("slug") slug: string,
    @Body() dto: ExchangeLinkDto,
    @Headers("user-agent") userAgent?: string,
  ) {
    return this.portalAccessService.exchange(slug, dto.token, userAgent);
  }
}
