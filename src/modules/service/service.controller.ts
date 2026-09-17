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
import { CreateServiceDto } from "./dto/create-service.dto";
import { FindServicesQueryDto } from "./dto/find-services-query.dto";
import { UpdateServiceDto } from "./dto/update-service.dto";
import { ServiceService } from "./service.service";

// Acesso de qualquer tipo de usuário, sempre restrito à empresa do usuário autenticado.
@Controller("services")
export class ServiceController {
  constructor(private readonly serviceService: ServiceService) {}

  @Post()
  create(
    @Body() dto: CreateServiceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.serviceService.create(dto, currentUser.companyId);
  }

  @Get()
  findAll(
    @Query() query: FindServicesQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.serviceService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.serviceService.findOne(id, currentUser.companyId);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.serviceService.update(id, dto, currentUser.companyId);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.serviceService.remove(id, currentUser.companyId);
  }
}
