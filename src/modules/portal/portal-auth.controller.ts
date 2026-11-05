import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
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
import { Public } from "../../common/decorators/public.decorator";
import { CurrentClient } from "./current-client.decorator";
import { CreateSessionDto } from "./dto/create-session.dto";
import { RequestCodeDto } from "./dto/request-code.dto";
import { VerifyCodeDto } from "./dto/verify-code.dto";
import { PortalAuthGuard } from "./portal-auth.guard";
import { PortalAuthService, type PortalClient } from "./portal-auth.service";

// Portal do cliente: fora do login da clínica (@Public para o JwtAuthGuard). A
// entrada é por código no WhatsApp; as rotas do cliente entrado usam o PortalAuthGuard.
@ApiTags("Portal do cliente")
@Public()
@Controller("portal/:slug")
export class PortalAuthController {
  constructor(private readonly portalAuthService: PortalAuthService) {}

  @Post("auth/code")
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse({ description: "Pedidos demais; aguarde." })
  @ApiOperation({
    summary: "Envia o código de entrada para o WhatsApp do telefone",
    description:
      "A resposta é a mesma com ou sem cadastro do telefone. Limite por IP e por telefone (3 em 10 minutos, 10 em 24 horas).",
  })
  requestCode(
    @Param("slug") slug: string,
    @Body() dto: RequestCodeDto,
    @Ip() ip: string,
  ) {
    return this.portalAuthService.requestCode(slug, dto.phone, ip);
  }

  @Post("auth/verify")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse({ description: "Tentativas demais; aguarde." })
  @ApiOperation({
    summary: "Confere o código e lista as pessoas da clínica com o telefone",
    description:
      "Até 5 tentativas por código, válido por 10 minutos. Lista vazia: o cliente informa o nome para se cadastrar.",
  })
  verifyCode(@Param("slug") slug: string, @Body() dto: VerifyCodeDto) {
    return this.portalAuthService.verifyCode(slug, dto.phone, dto.code);
  }

  @Post("auth/session")
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: "Abre a sessão do aparelho (90 dias)",
    description:
      "Com `personId` (uma das pessoas do telefone) ou `name` (cadastro novo com nome e telefone). Devolve o token do portal uma única vez.",
  })
  createSession(
    @Param("slug") slug: string,
    @Body() dto: CreateSessionDto,
    @Headers("user-agent") userAgent?: string,
  ) {
    return this.portalAuthService.createSession(slug, dto, userAgent);
  }

  @Get("me")
  @UseGuards(PortalAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Cliente entrado e a clínica do portal" })
  me(@CurrentClient() client: PortalClient) {
    return this.portalAuthService.me(client);
  }

  @Post("auth/logout")
  @HttpCode(204)
  @UseGuards(PortalAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Sai do portal neste aparelho" })
  logout(@CurrentClient() client: PortalClient) {
    return this.portalAuthService.logout(client);
  }
}
