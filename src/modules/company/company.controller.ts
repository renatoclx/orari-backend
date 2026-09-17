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
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CompanyService } from "./company.service";
import { CreateCompanyDto } from "./dto/create-company.dto";
import { FindCompaniesQueryDto } from "./dto/find-companies-query.dto";
import { UpdateCompanyDto } from "./dto/update-company.dto";

// Sem DELETE: empresas são inativadas via PATCH (isActive: false).
@Controller("companies")
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Post()
  @Roles(UserType.SUPER_ADMIN)
  create(@Body() dto: CreateCompanyDto) {
    return this.companyService.create(dto);
  }

  @Get()
  findAll(
    @Query() query: FindCompaniesQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.companyService.findAll(query, currentUser);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.companyService.findOne(id, currentUser);
  }

  @Patch(":id")
  @Roles(UserType.SUPER_ADMIN)
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.companyService.update(id, dto, currentUser);
  }
}
