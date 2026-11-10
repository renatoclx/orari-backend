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
import {
  Feature,
  FeatureAction,
} from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CommissionClosingService } from "./commission-closing.service";
import {
  CommissionClosingListQueryDto,
  CommissionClosingPreviewQueryDto,
  CreateCommissionClosingDto,
} from "./dto/commission-closing.dto";

// Fechamentos de comissão: só o ADMIN. Fechar exige "Edita" e desfazer
// "Exclui" na funcionalidade de comissões.
@ApiTags("Comissões")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("commissions")
@Controller("commission-closings")
export class CommissionClosingController {
  constructor(private readonly closingService: CommissionClosingService) {}

  @Get("preview")
  @ApiOperation({
    summary: "Prévia do fechamento até a data de corte",
    description:
      "Comissões em aberto de atendimentos até o fim da data (fuso da empresa) e adiantamentos em aberto até ela; a pagar = comissões − adiantamentos.",
  })
  preview(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: CommissionClosingPreviewQueryDto,
  ) {
    return this.closingService.preview(query, currentUser.companyId);
  }

  @Get()
  @ApiOperation({
    summary: "Fechamentos do profissional (inclusive desfeitos)",
  })
  list(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: CommissionClosingListQueryDto,
  ) {
    return this.closingService.list(
      query.professionalId,
      currentUser.companyId,
    );
  }

  @Get(":id")
  @ApiOperation({ summary: "Dados do recibo do fechamento" })
  receipt(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.closingService.receipt(id, currentUser.companyId);
  }

  @Post()
  @FeatureAction("edit")
  @ApiOperation({
    summary: "Fechar a comissão do profissional",
    description:
      "Quita tudo o que está em aberto até a data de corte (até hoje), com o pagamento (método ativo da empresa e data até hoje). Nada em aberto: 400. Gera o número do recibo (sequencial por empresa).",
  })
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: CreateCommissionClosingDto,
  ) {
    return this.closingService.create(
      dto,
      currentUser.companyId,
      currentUser.id,
    );
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({
    summary: "Desfazer o fechamento",
    description:
      "Só o último (não desfeito) do profissional (409). Fica marcado como cancelado e tudo volta ao em aberto.",
  })
  async cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.closingService.cancel(id, currentUser.companyId, currentUser.id);
  }
}
