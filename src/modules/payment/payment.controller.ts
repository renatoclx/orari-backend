import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { FindCheckoutsQueryDto } from "./dto/find-checkouts-query.dto";
import { FindPaymentsQueryDto } from "./dto/find-payments-query.dto";
import { SettleCheckoutDto } from "./dto/settle-checkout.dto";
import { SummaryPaymentsQueryDto } from "./dto/summary-payments-query.dto";
import { UpdatePaymentDto } from "./dto/update-payment.dto";
import { PaymentService } from "./payment.service";

// Acesso de qualquer tipo de usuário, sempre restrito à empresa do usuário autenticado.
@ApiTags("Pagamentos")
@ApiBearerAuth()
@Controller("payments")
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  create(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.paymentService.create(dto, currentUser.companyId);
  }

  @Get()
  findAll(
    @Query() query: FindPaymentsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.paymentService.findAll(query, currentUser.companyId);
  }

  // Comandas do dia, por cliente. Declarada antes de ":id" para não ser lida como id.
  @Get("checkouts")
  findCheckouts(
    @Query() query: FindCheckoutsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.paymentService.findCheckouts(query, currentUser.companyId);
  }

  // Totais da tela de Pagamentos (atrasado, a vencer, pago). Antes de ":id" pelo mesmo motivo.
  @Get("summary")
  summary(
    @Query() query: SummaryPaymentsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.paymentService.summary(query, currentUser.companyId);
  }

  // Baixa dos pagamentos escolhidos de um cliente. Antes de ":id" pelo mesmo motivo.
  @Patch("settle")
  settle(
    @Body() dto: SettleCheckoutDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.paymentService.settle(dto, currentUser.companyId);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.paymentService.findOne(id, currentUser.companyId);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.paymentService.update(id, dto, currentUser.companyId);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.paymentService.remove(id, currentUser.companyId);
  }
}
