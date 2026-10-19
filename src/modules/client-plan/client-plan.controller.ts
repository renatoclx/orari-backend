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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { ClientPlanService } from "./client-plan.service";
import {
  ClientPlanPageDto,
  ClientPlanResponseDto,
} from "./dto/client-plan-response.dto";
import { CreateClientPlanDto } from "./dto/create-client-plan.dto";
import { FindClientPlansQueryDto } from "./dto/find-client-plans-query.dto";

// Sem DELETE: a contratação é cancelada, e o histórico fica.
@ApiTags("Contratações de plano")
@ApiBearerAuth()
@Controller("client-plans")
export class ClientPlanController {
  constructor(private readonly clientPlanService: ClientPlanService) {}

  @Post()
  @ApiCreatedResponse({ type: ClientPlanResponseDto })
  create(
    @Body() dto: CreateClientPlanDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.clientPlanService.create(dto, currentUser.companyId);
  }

  @Get()
  @ApiOperation({
    summary: "Lista as contratações, da mais recente para a mais antiga",
    description:
      "Cada contratação traz o cliente, o plano e, em cada serviço, o serviço, " +
      "o profissional e os dias, mesmo que tenham sido excluídos ou inativados " +
      "depois. O filtro status usa o dia de hoje no fuso da empresa.",
  })
  @ApiOkResponse({ type: ClientPlanPageDto })
  findAll(
    @Query() query: FindClientPlansQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.clientPlanService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  @ApiOkResponse({ type: ClientPlanResponseDto })
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.clientPlanService.findOne(id, currentUser.companyId);
  }

  // Cancela sem multa: encerra as agendas e, no mensal, as parcelas a vencer.
  @Patch(":id/cancel")
  @ApiOkResponse({ type: ClientPlanResponseDto })
  cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.clientPlanService.cancel(id, currentUser.companyId);
  }
}
