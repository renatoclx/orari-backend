import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { CheckAccessLinkDto, UseAccessLinkDto } from "./dto/access-link.dto";
import { PortalAccessService } from "./portal-access.service";
import { bearerToken } from "./portal-auth.guard";
import { PortalAuthService } from "./portal-auth.service";

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
    summary: "Gera o link de acesso ao app para o cliente (24 h, uso único)",
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

// A clínica confirma o cliente que entrou sozinho pelo app.
@ApiTags("Portal do cliente (clínica)")
@ApiBearerAuth()
@Controller("people/:id/portal-confirm")
export class PortalClientConfirmController {
  constructor(private readonly portalAccessService: PortalAccessService) {}

  @Patch()
  @HttpCode(204)
  @Feature("clients")
  @FeatureAction("edit")
  @ApiOperation({
    summary: "Confirma o cliente que entrou sozinho pelo app",
    description:
      "Tira a marca de telefone não confirmado e o limite de 2 agendamentos futuros. Já confirmado: 204 sem mudar nada. Fica na auditoria.",
  })
  confirm(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.portalAccessService.confirm(id, currentUser, ip);
  }
}

// O cliente abre o link no app: liga o cadastro à conta, cria a conta ou cria
// uma senha nova. Fica junto da conta, em /portal-account (ver PortalAccountController).
@ApiTags("Portal do cliente")
@Public()
@UseGuards(ThrottlerGuard)
@ApiTooManyRequestsResponse({ description: "Tentativas demais; aguarde." })
@Controller("portal-account/link")
export class PortalAccessUseController {
  constructor(
    private readonly portalAccessService: PortalAccessService,
    private readonly portalAuthService: PortalAuthService,
  ) {}

  @Post("check")
  @HttpCode(200)
  @ApiOperation({
    summary: "Confere o link sem usá-lo",
    description:
      "Devolve o estabelecimento, o nome do cliente, `needsPhone` (o cadastro não tem telefone) e `hasAccount` (a senha será a nova senha de uma conta que já existe). Link inválido, usado ou vencido: 400.",
  })
  check(@Body() dto: CheckAccessLinkDto) {
    return this.portalAccessService.check(dto.token);
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Usa o link de acesso (uma vez só)",
    description:
      "Com o token do portal: liga o cadastro do estabelecimento à conta entrada (devolve só `place`). Sem ele: `password` cria a conta ou é a senha nova da conta que já existe (os outros aparelhos saem); devolve também `token` e `expiresAt`. `phone` só quando `needsPhone`.",
  })
  async use(
    @Body() dto: UseAccessLinkDto,
    @Headers("authorization") authorization?: string,
    @Headers("user-agent") userAgent?: string,
  ) {
    const token = bearerToken({ headers: { authorization }, params: {} });
    // Token presente mas inválido: 401, para o app não criar outra conta sem querer.
    const account = token
      ? await this.portalAuthService.authenticate(token)
      : null;
    return this.portalAccessService.use(dto, account, userAgent);
  }
}
