import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
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
import { Public } from "../../common/decorators/public.decorator";
import { CurrentAccount } from "./current-account.decorator";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { PortalAuthGuard } from "./portal-auth.guard";
import { PortalAuthService, type PortalAccount } from "./portal-auth.service";
import { PortalPlaceService } from "./portal-place.service";

// Conta do cliente no app, fora do login da clínica (@Public para o
// JwtAuthGuard). Fica em /portal-account, e não em /portal, para não disputar
// o endereço com o /portal/:slug de cada clínica.
@ApiTags("Portal do cliente")
@Public()
@Controller("portal-account")
export class PortalAccountController {
  constructor(
    private readonly portalAuthService: PortalAuthService,
    private readonly portalPlaceService: PortalPlaceService,
  ) {}

  @Post("register")
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse({ description: "Pedidos demais; aguarde." })
  @ApiOperation({
    summary: "Cria a conta do cliente (telefone + senha) e abre a sessão",
    description:
      "Telefone já usado por outra conta: 409. A conta nasce sem nenhum estabelecimento ligado. Devolve o token do portal (90 dias) uma única vez.",
  })
  register(
    @Body() dto: RegisterDto,
    @Headers("user-agent") userAgent?: string,
  ) {
    return this.portalAuthService.register(dto, userAgent);
  }

  @Post("login")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse({ description: "Tentativas demais; aguarde." })
  @ApiOperation({
    summary: "Entra com telefone e senha (sessão de 90 dias neste aparelho)",
    description: "Telefone sem conta ou senha errada: o mesmo 401.",
  })
  login(@Body() dto: LoginDto, @Headers("user-agent") userAgent?: string) {
    return this.portalAuthService.login(dto, userAgent);
  }

  @Get()
  @UseGuards(PortalAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "A conta entrada e os estabelecimentos dela",
    description:
      "`places` traz só os estabelecimentos com o portal aberto, em ordem alfabética, cada um com `slug`, nome, logo e fuso.",
  })
  me(@CurrentAccount() account: PortalAccount) {
    return this.portalAuthService.me(account);
  }

  @Get("appointments")
  @UseGuards(PortalAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Agendamentos da conta em todos os estabelecimentos",
    description:
      "`upcoming` (do mais perto ao mais longe) e `past` (os 20 mais recentes). Cada item é o da lista de um estabelecimento, com `place` (slug, nome, logo e fuso).",
  })
  appointments(@CurrentAccount() account: PortalAccount) {
    return this.portalPlaceService.appointments(account);
  }

  @Post("places/:subdomain")
  @HttpCode(200)
  @UseGuards(PortalAuthGuard, ThrottlerGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Entra sozinho num estabelecimento",
    description:
      "Cria um cadastro novo de cliente com o nome e o telefone da conta, marcado como não confirmado (até a clínica confirmar, no máximo 2 agendamentos futuros pelo app). Nunca junta com um cadastro existente. Já sendo cliente: `joined: false`. Portal fechado: 404.",
  })
  join(
    @CurrentAccount() account: PortalAccount,
    @Param("subdomain") subdomain: string,
  ) {
    return this.portalPlaceService.join(account, subdomain);
  }

  @Patch("password")
  @HttpCode(204)
  @UseGuards(PortalAuthGuard, ThrottlerGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Troca a senha conferindo a atual",
    description:
      "Senha atual errada: 400. Os outros aparelhos saem; este continua entrado.",
  })
  changePassword(
    @CurrentAccount() account: PortalAccount,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.portalAuthService.changePassword(account, dto);
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(PortalAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Sai do app neste aparelho" })
  logout(@CurrentAccount() account: PortalAccount) {
    return this.portalAuthService.logout(account);
  }
}
