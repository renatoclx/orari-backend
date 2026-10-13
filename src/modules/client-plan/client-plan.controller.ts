import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { ClientPlanService } from "./client-plan.service";
import { CreateClientPlanDto } from "./dto/create-client-plan.dto";
import { FindClientPlansQueryDto } from "./dto/find-client-plans-query.dto";

// Sem DELETE: a contratação é cancelada, e o histórico fica.
@ApiTags("Contratações de plano")
@ApiBearerAuth()
@Controller("client-plans")
export class ClientPlanController {
  constructor(private readonly clientPlanService: ClientPlanService) {}

  @Post()
  create(
    @Body() dto: CreateClientPlanDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.clientPlanService.create(dto, currentUser.companyId);
  }

  @Get()
  findAll(
    @Query() query: FindClientPlansQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.clientPlanService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.clientPlanService.findOne(id, currentUser.companyId);
  }

  // Cancela sem multa: encerra as agendas e, no mensal, as parcelas a vencer.
  @Patch(":id/cancel")
  cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.clientPlanService.cancel(id, currentUser.companyId);
  }
}
