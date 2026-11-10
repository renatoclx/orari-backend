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
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import {
  Feature,
  FeatureAction,
} from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreateExpenseCategoryDto } from "./dto/create-expense-category.dto";
import { FindExpenseCategoriesQueryDto } from "./dto/find-expense-categories-query.dto";
import { UpdateExpenseCategoryDto } from "./dto/update-expense-category.dto";
import { ExpenseCategoryService } from "./expense-category.service";

// Só o ADMIN (contas a pagar são da administração), restrito à empresa do usuário.
@ApiTags("Categorias de despesa")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("expense-categories")
@Controller("expense-categories")
export class ExpenseCategoryController {
  constructor(
    private readonly expenseCategoryService: ExpenseCategoryService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateExpenseCategoryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.expenseCategoryService.create(dto, currentUser.companyId);
  }

  @Get()
  findAll(
    @Query() query: FindExpenseCategoriesQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.expenseCategoryService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.expenseCategoryService.findOne(id, currentUser.companyId);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseCategoryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.expenseCategoryService.update(id, dto, currentUser.companyId);
  }

  // Reativa uma categoria inativada (limpa o deletedAt).
  @FeatureAction("remove")
  @Patch(":id/restore")
  restore(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.expenseCategoryService.restore(id, currentUser.companyId);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.expenseCategoryService.remove(id, currentUser.companyId);
  }
}
