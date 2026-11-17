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
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import {
  CreateSubscriptionPaymentDto,
  SubscriptionPaymentQueryDto,
} from "./dto/create-subscription-payment.dto";
import { SubscriptionPaymentService } from "./subscription-payment.service";

// Cobranças das assinaturas: só o SUPER_ADMIN (cobrança manual).
@ApiTags("Cobranças")
@ApiBearerAuth()
@Roles(UserType.SUPER_ADMIN)
@Controller()
export class SubscriptionPaymentController {
  constructor(private readonly service: SubscriptionPaymentService) {}

  @Get("subscription-payments")
  @ApiOperation({
    summary: "Pagamentos de um mês, de todas as empresas",
    description:
      "`month` (AAAA-MM; sem ele, o mês atual em Brasília), pela data do pagamento. Traz o total e a quantidade.",
  })
  listByMonth(@Query() query: SubscriptionPaymentQueryDto) {
    return this.service.listByMonth(query);
  }

  @Get("companies/:companyId/subscription/payments")
  @ApiOperation({
    summary: "Pagamentos da empresa e a sugestão do próximo",
    description:
      "Mais recente primeiro. `suggestion` (nulo sem assinatura): o próximo período do ciclo e o valor com o desconto que valer nele.",
  })
  listForCompany(@Param("companyId", ParseUUIDPipe) companyId: string) {
    return this.service.listForCompany(companyId);
  }

  @Post("companies/:companyId/subscription/payments")
  @ApiOperation({
    summary: "Registra um pagamento da assinatura",
    description:
      "Avança o pago até da assinatura para o fim do período (nunca o recua). Sem assinatura: 404.",
  })
  create(
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @Body() dto: CreateSubscriptionPaymentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.service.create(companyId, dto, currentUser, ip);
  }

  @Delete("companies/:companyId/subscription/payments/:paymentId")
  @HttpCode(204)
  @ApiOperation({
    summary: "Exclui o pagamento mais recente (lançado por engano)",
    description:
      "Devolve o pago até de antes dele. Outro que não o mais recente: 409.",
  })
  remove(
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @Param("paymentId", ParseUUIDPipe) paymentId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.service.remove(companyId, paymentId, currentUser, ip);
  }
}
