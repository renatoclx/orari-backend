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
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreatePaymentMethodDto } from "./dto/create-payment-method.dto";
import { FindPaymentMethodsQueryDto } from "./dto/find-payment-methods-query.dto";
import { UpdatePaymentMethodDto } from "./dto/update-payment-method.dto";
import { PaymentMethodService } from "./payment-method.service";

// Acesso de qualquer tipo de usuário, sempre restrito à empresa do usuário autenticado.
@Controller("payment-methods")
export class PaymentMethodController {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}

  @Post()
  create(
    @Body() dto: CreatePaymentMethodDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.paymentMethodService.create(dto, currentUser.companyId);
  }

  @Get()
  findAll(
    @Query() query: FindPaymentMethodsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.paymentMethodService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.paymentMethodService.findOne(id, currentUser.companyId);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentMethodDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.paymentMethodService.update(id, dto, currentUser.companyId);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.paymentMethodService.remove(id, currentUser.companyId);
  }
}
