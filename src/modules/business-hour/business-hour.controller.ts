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
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreateBusinessHourDto } from "./dto/create-business-hour.dto";
import { FindBusinessHoursQueryDto } from "./dto/find-business-hours-query.dto";
import { UpdateBusinessHourDto } from "./dto/update-business-hour.dto";
import { BusinessHourService } from "./business-hour.service";

// Acesso de qualquer tipo de usuário, sempre restrito à empresa do usuário autenticado.
@Controller("business-hours")
export class BusinessHourController {
  constructor(private readonly businessHourService: BusinessHourService) {}

  @Post()
  create(
    @Body() dto: CreateBusinessHourDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.businessHourService.create(dto, currentUser.companyId);
  }

  @Get()
  findAll(
    @Query() query: FindBusinessHoursQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.businessHourService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.businessHourService.findOne(id, currentUser.companyId);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateBusinessHourDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.businessHourService.update(id, dto, currentUser.companyId);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.businessHourService.remove(id, currentUser.companyId);
  }
}
