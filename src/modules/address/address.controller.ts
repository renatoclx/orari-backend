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
import { FindOwnedQueryDto } from "../../common/dto/find-owned-query.dto";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { AddressService } from "./address.service";
import { CreateAddressDto } from "./dto/create-address.dto";
import { UpdateAddressDto } from "./dto/update-address.dto";

// Acesso de qualquer tipo de usuário, sempre restrito à empresa do usuário autenticado.
@Controller("addresses")
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  @Post()
  create(
    @Body() dto: CreateAddressDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.addressService.create(dto, currentUser.companyId);
  }

  @Get()
  findAll(
    @Query() query: FindOwnedQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.addressService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.addressService.findOne(id, currentUser.companyId);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.addressService.update(id, dto, currentUser.companyId);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.addressService.remove(id, currentUser.companyId);
  }
}
