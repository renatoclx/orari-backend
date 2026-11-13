import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ProfessionalApp } from "../../common/decorators/professional-app.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import {
  PushSubscriptionDto,
  PushUnsubscribeDto,
} from "../portal/dto/push-subscription.dto";
import { FindNotificationsQueryDto } from "./dto/find-notifications-query.dto";
import { UpdateNotificationPreferencesDto } from "./dto/notification-preferences.dto";
import { NotificationService } from "./notification.service";

// A caixa de notificações de quem está logado (o sino do painel e do app do
// profissional). Vale para qualquer usuário da empresa e não depende de plano:
// cada um só enxerga e altera as próprias. Sem POST de notificação: elas são
// criadas pela própria API.
@ApiTags("Notificações")
@ApiBearerAuth()
@ProfessionalApp()
@Controller("notifications")
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({
    summary: "Notificações do usuário, das mais novas às mais antigas",
    description:
      "10 por página; `onlyUnread` filtra as não lidas. Traz também `unread`, o total de não lidas (o número do sino).",
  })
  findAll(
    @Query() query: FindNotificationsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.notificationService.findAll(currentUser, query);
  }

  @Get("unread-count")
  @ApiOperation({ summary: "Quantas notificações não lidas (o sino)" })
  unreadCount(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.notificationService.unreadCount(currentUser);
  }

  @Patch("read-all")
  @HttpCode(204)
  @ApiOperation({ summary: "Marca todas como lidas" })
  markAllAsRead(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.notificationService.markAllAsRead(currentUser);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({
    summary: "Limpa a caixa de notificações",
    description:
      "Tudo some da lista e do contador. Os registros ficam (a deduplicação continua valendo): um evento repetido não volta a avisar.",
  })
  clearAll(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.notificationService.clearAll(currentUser);
  }

  @Get("preferences")
  @ApiOperation({
    summary: "O push de cada categoria e a chave pública do push",
    description:
      "A caixa recebe tudo; só o push tem interruptor. A chave é nula com o push desligado no servidor.",
  })
  preferences(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.notificationService.preferences(currentUser);
  }

  @Put("preferences")
  @ApiOperation({ summary: "Liga ou desliga o push de cada categoria" })
  updatePreferences(
    @Body() dto: UpdateNotificationPreferencesDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.notificationService.updatePreferences(currentUser, dto);
  }

  @Post("push/subscriptions")
  @HttpCode(204)
  @ApiOperation({
    summary: "Ativa o push neste aparelho",
    description:
      "O corpo é o `PushSubscription.toJSON()` do navegador. Só endereços dos serviços de push conhecidos (400). Push desligado no servidor: 503.",
  })
  subscribe(
    @Body() dto: PushSubscriptionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Headers("user-agent") userAgent?: string,
  ) {
    return this.notificationService.subscribe(currentUser, dto, userAgent);
  }

  @Delete("push/subscriptions")
  @HttpCode(204)
  @ApiOperation({ summary: "Desativa o push neste aparelho" })
  unsubscribe(
    @Body() dto: PushUnsubscribeDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.notificationService.unsubscribe(currentUser, dto.endpoint);
  }

  @Patch(":id/read")
  @HttpCode(204)
  @ApiOperation({ summary: "Marca uma notificação como lida" })
  markAsRead(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.notificationService.markAsRead(currentUser, id);
  }
}
