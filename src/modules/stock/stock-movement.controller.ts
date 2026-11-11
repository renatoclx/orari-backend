import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import {
  Feature,
  FeatureAction,
} from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreateStockMovementDto } from "./dto/create-stock-movement.dto";
import { StockMovementService } from "./stock-movement.service";

// Estoque do produto: só o ADMIN, dentro da funcionalidade Produtos.
@ApiTags("Produtos")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("products")
@Controller("products/:productId/stock-movements")
export class StockMovementController {
  constructor(private readonly stockMovementService: StockMovementService) {}

  // Movimentar o estoque é alterar o produto (Edita).
  @FeatureAction("edit")
  @Post()
  create(
    @Param("productId", ParseUUIDPipe) productId: string,
    @Body() dto: CreateStockMovementDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.stockMovementService.create(
      productId,
      dto,
      currentUser.companyId,
      currentUser.id,
    );
  }

  @Get()
  findAll(
    @Param("productId", ParseUUIDPipe) productId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.stockMovementService.findAll(
      productId,
      query,
      currentUser.companyId,
    );
  }
}
