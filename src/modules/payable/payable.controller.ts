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
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import {
  Feature,
  FeatureAction,
} from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreatePayableDto } from "./dto/create-payable.dto";
import {
  PayableListQueryDto,
  PayableSummaryQueryDto,
} from "./dto/payable-query.dto";
import { SettlePayablesDto } from "./dto/settle-payables.dto";
import { UpdatePayableDto } from "./dto/update-payable.dto";
import { PayableService } from "./payable.service";

// Contas a pagar: só o ADMIN, restrito à empresa do usuário. Pagar é "Edita";
// cancelar e excluir, "Exclui/Inativa".
@ApiTags("Contas a pagar")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("payables")
@Controller("payables")
export class PayableController {
  constructor(private readonly payableService: PayableService) {}

  @Get("summary")
  @ApiOperation({
    summary: "Atrasado, a vencer e pago (com os mesmos filtros da lista)",
  })
  summary(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: PayableSummaryQueryDto,
  ) {
    return this.payableService.summary(query, currentUser.companyId);
  }

  @Get()
  @ApiOperation({
    summary: "Contas a pagar (paginado)",
    description:
      "`status`: pending (padrão), overdue, upcoming, paid, cancelled ou all; `payeeId`, `categoryId`, `dueFrom`/`dueTo` (AAAA-MM-DD, pontas incluídas). Pendentes do vencimento mais próximo; pagas da mais recente. `overdue` em cada item: pendente vencida.",
  })
  list(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: PayableListQueryDto,
  ) {
    return this.payableService.list(query, currentUser.companyId);
  }

  @Post()
  @ApiOperation({
    summary: "Lançar conta (ou série)",
    description:
      "`repeat`: installments (divide o valor em N, a última leva o resto dos centavos) ou monthly (mesmo valor por N meses), de 2 a 60, uma por mês a partir do vencimento. `paid` (data até hoje e método ativo) só sem repetição. Favorecido: fornecedor ou profissional ativo da empresa; categoria ativa.",
  })
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: CreatePayableDto,
  ) {
    return this.payableService.create(
      dto,
      currentUser.companyId,
      currentUser.id,
    );
  }

  @Patch("settle")
  @FeatureAction("edit")
  @ApiOperation({
    summary: "Pagar contas pendentes (uma ou várias)",
    description:
      "Mesma data (até hoje) e método ativo para todas; alguma não pendente ou de outra empresa: 409, nada muda.",
  })
  settle(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: SettlePayablesDto,
  ) {
    return this.payableService.settle(dto, currentUser.companyId);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Alterar só esta conta (pendente; senão 409)" })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: UpdatePayableDto,
  ) {
    return this.payableService.update(id, dto, currentUser.companyId);
  }

  @Patch(":id/cancel")
  @HttpCode(204)
  @FeatureAction("remove")
  @ApiOperation({ summary: "Cancelar só esta conta (pendente; senão 409)" })
  async cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.payableService.cancel(id, currentUser.companyId);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({
    summary: "Excluir lançamento errado (pendente ou cancelado; paga: 409)",
  })
  async remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.payableService.remove(id, currentUser.companyId);
  }
}
