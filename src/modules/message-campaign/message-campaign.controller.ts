import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import {
  Feature,
  FeatureAction,
} from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreateMessageCampaignDto } from "./dto/create-message-campaign.dto";
import { MessageCampaignService } from "./message-campaign.service";

// Mensagens escritas pela clínica: só o ADMIN e com Mensagens no plano
// (ler = Visualiza; enviar = Edita).
@ApiTags("Mensagens (clínica)")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("messages")
@Controller("message-campaigns")
export class MessageCampaignController {
  constructor(
    private readonly messageCampaignService: MessageCampaignService,
  ) {}

  @Get("audience")
  @ApiOperation({
    summary: "Quem recebe: clientes ativos com o app",
    description:
      "`clients`: clientes ativos com conta no app; `promotionsOff`: quantos deles desligaram as novidades e promoções (não recebem); `canSendToday`: ainda não houve envio hoje.",
  })
  audience(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.messageCampaignService.audience(currentUser.companyId);
  }

  @Get()
  @ApiOperation({
    summary: "Histórico das mensagens enviadas (mais recentes primeiro)",
  })
  findAll(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.messageCampaignService.findAll(
      currentUser.companyId,
      query.page,
      query.limit,
    );
  }

  @Post()
  // Mensagens só tem Visualiza e Edita: enviar é Edita (o POST seria "Cria").
  @FeatureAction("edit")
  @ApiOperation({
    summary: "Envia a mensagem a todos os clientes com o app",
    description:
      "Uma por dia por clínica, no dia do fuso dela (a segunda: 409). Só `{nome}` e `{estabelecimento}` (outra variável: 400). Portal desligado: 409. Devolve `recipients`: quantos receberam (quem desligou as promoções não conta).",
  })
  send(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: CreateMessageCampaignDto,
  ) {
    return this.messageCampaignService.send(
      currentUser.companyId,
      currentUser.id,
      dto,
    );
  }
}
