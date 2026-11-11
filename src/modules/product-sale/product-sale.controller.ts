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
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import {
  Feature,
  FeatureAction,
} from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreateProductSaleDto } from "./dto/create-product-sale.dto";
import { FindSaleProductsQueryDto } from "./dto/find-sale-products-query.dto";
import { ProductSaleService } from "./product-sale.service";

// Venda de produtos na comanda: só o ADMIN vende (a comanda mostra a todos).
@ApiTags("Venda de produtos")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("product-sales")
@Controller("product-sales")
export class ProductSaleController {
  constructor(private readonly productSaleService: ProductSaleService) {}

  // Busca da comanda: produtos ativos, com preço e estoque.
  @Get("products")
  findProducts(
    @Query() query: FindSaleProductsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productSaleService.findProducts(
      query.search,
      currentUser.companyId,
    );
  }

  @Post()
  create(
    @Body() dto: CreateProductSaleDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productSaleService.create(
      dto,
      currentUser.companyId,
      currentUser.id,
    );
  }

  // Cancelar a venda pendente é a ação Exclui da funcionalidade.
  @FeatureAction("remove")
  @Patch(":id/cancel")
  cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productSaleService.cancel(
      id,
      currentUser.companyId,
      currentUser.id,
    );
  }
}
