import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import { AUTH_THROTTLER } from "../auth/auth-throttle";
import { CurrentAccount } from "./current-account.decorator";
import { PushPreferencesDto } from "./dto/push-preferences.dto";
import {
  PushSubscriptionDto,
  PushUnsubscribeDto,
} from "./dto/push-subscription.dto";
import { PortalAuthGuard } from "./portal-auth.guard";
import type { PortalAccount } from "./portal-auth.service";
import { PortalPushService } from "./portal-push.service";

// Avisos de teste por conta e IP: o bastante para conferir a instalação, sem
// virar um jeito de disparar notificações em massa.
export const PUSH_TEST_LIMIT = { limit: 5, ttl: 10 * 60_000 };

// Avisos do app (Web Push) e a caixa de Avisos, com a sessão do cliente.
@ApiTags("Portal do cliente")
@Public()
@UseGuards(PortalAuthGuard)
@ApiBearerAuth()
@Controller("portal-account")
export class PortalPushController {
  constructor(private readonly portalPushService: PortalPushService) {}

  @Get("push")
  @ApiOperation({
    summary: "Chave pública do push e os interruptores dos avisos",
    description:
      "`publicKey` nulo: os avisos estão desligados no servidor (o app não oferece ativar). `notifyAppointments`: lembretes e agendamentos; `notifyPromotions`: aniversário, sentimos sua falta e mensagens da clínica.",
  })
  info(@CurrentAccount() account: PortalAccount) {
    return this.portalPushService.info(account);
  }

  @Post("push/subscriptions")
  @HttpCode(204)
  @ApiOperation({
    summary: "Ativa os avisos neste aparelho",
    description:
      "O corpo é o `PushSubscription.toJSON()` do navegador. Só endereços dos serviços de push conhecidos (400). Push desligado no servidor: 503. Ao sair do app, a inscrição do aparelho é apagada.",
  })
  subscribe(
    @CurrentAccount() account: PortalAccount,
    @Body() dto: PushSubscriptionDto,
    @Headers("user-agent") userAgent?: string,
  ) {
    return this.portalPushService.subscribe(account, dto, userAgent);
  }

  @Delete("push/subscriptions")
  @HttpCode(204)
  @ApiOperation({ summary: "Desativa os avisos neste aparelho" })
  unsubscribe(
    @CurrentAccount() account: PortalAccount,
    @Body() dto: PushUnsubscribeDto,
  ) {
    return this.portalPushService.unsubscribe(account, dto.endpoint);
  }

  @Put("push/preferences")
  @ApiOperation({
    summary: "Liga ou desliga cada tipo de aviso",
    description:
      "Desligado, o aviso do tipo nem entra na caixa de Avisos nem é enviado. O aviso de teste não depende deles.",
  })
  preferences(
    @CurrentAccount() account: PortalAccount,
    @Body() dto: PushPreferencesDto,
  ) {
    return this.portalPushService.updatePreferences(account, dto);
  }

  @Post("push/test")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ [AUTH_THROTTLER]: PUSH_TEST_LIMIT })
  @ApiTooManyRequestsResponse({ description: "Testes demais; aguarde." })
  @ApiOperation({
    summary: "Envia um aviso de teste aos aparelhos da conta",
    description:
      "`devices`: para quantos aparelhos saiu (0: nenhum com os avisos ativados). Push desligado no servidor: 503.",
  })
  test(@CurrentAccount() account: PortalAccount) {
    return this.portalPushService.sendTest(account);
  }

  @Get("messages")
  @ApiOperation({
    summary: "A caixa de Avisos",
    description:
      "Dos mais novos aos mais antigos, paginada (`page`, `limit` até 100). Cada aviso traz `kind`, título, texto, `url` do app, `readAt` e `place` (nome e logo da clínica; nulo no teste). `unread`: não lidos.",
  })
  messages(
    @CurrentAccount() account: PortalAccount,
    @Query() query: PaginationQueryDto,
  ) {
    return this.portalPushService.messages(account, query.page, query.limit);
  }

  @Patch("messages/read")
  @HttpCode(204)
  @ApiOperation({ summary: "Marca todos os avisos como lidos" })
  markRead(@CurrentAccount() account: PortalAccount) {
    return this.portalPushService.markAllRead(account);
  }
}
