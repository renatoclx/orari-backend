import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CommissionAdvanceService } from "./commission-advance.service";
import {
  CommissionAdvanceQueryDto,
  CreateCommissionAdvanceDto,
} from "./dto/create-commission-advance.dto";

// Adiantamentos de comissão: só o ADMIN, restrito à empresa do usuário.
// Lançar exige "Cria" e excluir "Exclui" na funcionalidade de comissões.
@ApiTags("Comissões")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("commissions")
@Controller("commission-advances")
export class CommissionAdvanceController {
  constructor(private readonly advanceService: CommissionAdvanceService) {}

  @Get()
  @ApiOperation({
    summary: "Adiantamentos em aberto de um profissional",
    description:
      "Do mais recente para o mais antigo, com quem lançou. Profissional de outra empresa: 404.",
  })
  list(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: CommissionAdvanceQueryDto,
  ) {
    return this.advanceService.list(
      query.professionalId,
      currentUser.companyId,
    );
  }

  @Get("available")
  @ApiOperation({
    summary: "Disponível para adiantar ao profissional",
    description: "A comissão em aberto menos os adiantamentos em aberto.",
  })
  available(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: CommissionAdvanceQueryDto,
  ) {
    return this.advanceService.available(
      query.professionalId,
      currentUser.companyId,
    );
  }

  @Post()
  @ApiOperation({
    summary: "Lançar adiantamento",
    description:
      "Data até hoje (no fuso da empresa; futura é 400) e valor até o disponível para adiantar (400).",
  })
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: CreateCommissionAdvanceDto,
  ) {
    return this.advanceService.create(
      dto,
      currentUser.companyId,
      currentUser.id,
    );
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({
    summary: "Excluir adiantamento lançado errado",
    description: "Enquanto não houver fechamento. De outra empresa: 404.",
  })
  async remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.advanceService.remove(id, currentUser.companyId);
  }
}
