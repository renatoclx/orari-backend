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
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { FindPaymentsQueryDto } from "./dto/find-payments-query.dto";
import { UpdatePaymentDto } from "./dto/update-payment.dto";
import { PaymentService } from "./payment.service";

// Acesso de qualquer tipo de usuário, sempre restrito à empresa do usuário autenticado.
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
