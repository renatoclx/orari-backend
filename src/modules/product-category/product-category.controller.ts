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
import { Feature } from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreateProductCategoryDto } from "./dto/create-product-category.dto";
import { FindProductCategoriesQueryDto } from "./dto/find-product-categories-query.dto";
import { UpdateProductCategoryDto } from "./dto/update-product-category.dto";
import { ProductCategoryService } from "./product-category.service";

// Só o ADMIN, restrito à empresa do usuário. Sem DELETE: a categoria é inativada pelo PATCH.
@ApiTags("Categorias de produto")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("product-categories")
@Controller("product-categories")
export class ProductCategoryController {
  constructor(
    private readonly productCategoryService: ProductCategoryService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateProductCategoryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productCategoryService.create(dto, currentUser.companyId);
  }

  @Get()
  findAll(
    @Query() query: FindProductCategoriesQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productCategoryService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productCategoryService.findOne(id, currentUser.companyId);
  }

  // Altera o nome, inativa ou reativa.
  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductCategoryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productCategoryService.update(id, dto, currentUser.companyId);
  }
}
