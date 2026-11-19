import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { UpdateSubscriptionDto } from "./dto/update-subscription.dto";
import { SubscriptionService } from "./subscription.service";

// Só o SUPER_ADMIN gerencia as assinaturas das empresas.
@ApiTags("Assinaturas")
@ApiBearerAuth()
@Roles(UserType.SUPER_ADMIN)
@Controller()
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get("subscriptions")
  @ApiOperation({
    summary: "Empresas com a assinatura de cada uma",
    description:
      "Todas as empresas, menos a da plataforma, da mais recente para a mais " +
      "antiga; `subscription` nulo quando a empresa não tem assinatura.",
  })
  findAll(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.subscriptionService.findAll(currentUser);
  }

  @Get("companies/:companyId/subscription")
  @ApiOperation({
    summary: "Assinatura da empresa, com a situação calculada",
    description: "Nulo quando a empresa não tem assinatura.",
  })
  findOne(@Param("companyId", ParseUUIDPipe) companyId: string) {
    return this.subscriptionService.findOne(companyId);
  }

  @Put("companies/:companyId/subscription")
  @ApiOperation({
    summary: "Cria ou substitui a assinatura da empresa",
    description:
      "Exige o fim do teste ou o pago até. A situação sai das datas: em teste, " +
      "ativa, em atraso (5 dias depois do vencimento), somente leitura ou cancelada.",
  })
  replace(
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @Body() dto: UpdateSubscriptionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.subscriptionService.replace(companyId, dto, currentUser, ip);
  }

  @Post("companies/:companyId/subscription/cancel")
  @HttpCode(200)
  @ApiOperation({
    summary: "Cancela a assinatura",
    description:
      "A data sai sozinha: a empresa usa até o fim do que já pagou (ou do teste em andamento) e só consulta a partir do dia seguinte. Sem assinatura: 404.",
  })
  cancel(
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.subscriptionService.cancel(companyId, currentUser, ip);
  }

  @Delete("companies/:companyId/subscription/cancel")
  @ApiOperation({ summary: "Desfaz o cancelamento da assinatura" })
  reactivate(
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.subscriptionService.reactivate(companyId, currentUser, ip);
  }
}
